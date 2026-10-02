// HTTP + Socket.IO 伺服器：登入、配對（含電腦玩家）、牌位結算、老師頁 API，
// 以及把玩家操作交給規則引擎（企畫書第 10、12.5、18 節）。
import express, { type Request } from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { randomInt, randomUUID } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import type { Choice, FunctionName, PlayerId, RankChange } from '../shared/types';
import { applyOutcome, tierOf, type Outcome } from '../shared/rank';
import type { Content } from './content';
import { applyAction, createGame, setConnected, tick, view, type Action, type GameState } from './engine';
import { checkLogin, checkNickname, checkSeat, profileOf, Store, type Account } from './store';
import { BotBrain, ensureBots, pickBot, skillFor } from './bot';

const COLORS = ['藍色', '紅色', '綠色', '黃色', '紫色', '橘色', '白色', '銀色', '金色', '粉紅'];
const ANIMALS = ['貓頭鷹', '海豚', '狐狸', '熊貓', '企鵝', '松鼠', '老虎', '兔子', '烏龜', '鯨魚'];
const randomNickname = () => `${COLORS[randomInt(COLORS.length)]}${ANIMALS[randomInt(ANIMALS.length)]}`;
const TOKEN_RE = /^[0-9a-f-]{36}$/i;
const PIDS: PlayerId[] = ['p1', 'p2'];

interface Session {
  token: string;
  accountId: string | null;
  socketId: string | null;
  gameId: string | null;
  pid: PlayerId | null;
  /** 電腦玩家的 session：沒有連線，由 BotBrain 代為操作。 */
  bot: boolean;
}

interface PendingMatch {
  id: string;
  tokens: [string, string];
  ready: Set<string>;
  deadline: number;
  /** 對上電腦玩家時，電腦玩家在這個時間按「準備」（像真人一樣慢一點）。 */
  botReadyAt: number | null;
}

export interface AppOptions {
  content: Content;
  /** 靜態檔目錄（vite build 的輸出）；沒有就只提供 Socket.IO。 */
  staticDir?: string;
  /** 帳號資料檔；null 或不給就只放在記憶體（測試用）。 */
  dataFile?: string | null;
  /** 排隊多久還沒人就改配電腦玩家（毫秒，在這個範圍內隨機）；null 表示不配電腦玩家。 */
  botWaitMs?: [number, number] | null;
  now?: () => number;
  rng?: () => number;
  tickMs?: number;
}

export interface App {
  http: HttpServer;
  io: Server;
  games: Map<string, GameState>;
  store: Store;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

/** 學生要連的網址：這台電腦在區域網路上的 IPv4 位址。 */
export function lanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal) urls.push(`http://${n.address}${port === 80 ? '' : `:${port}`}`);
    }
  }
  return urls;
}

const isLocalRequest = (req: Request) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');

export function createApp(opts: AppOptions): App {
  const now = opts.now ?? Date.now;
  const rng = opts.rng ?? Math.random;
  const { content } = opts;
  const botWait = opts.botWaitMs === undefined ? ([10_000, 22_000] as [number, number]) : opts.botWaitMs;
  const store = new Store(opts.dataFile ?? null);
  if (botWait) ensureBots(store, now(), rng);

  const app = express();
  const http = createServer(app);
  const io = new Server(http, { cors: { origin: true } });
  let listeningPort = 0;

  const sessions = new Map<string, Session>();
  const queue: string[] = [];
  const queuedAt = new Map<string, number>();
  const pending = new Map<string, PendingMatch>();
  const games = new Map<string, GameState>();
  const brains = new Map<string, BotBrain>();
  const flushed = new Map<string, number>();
  const finishedAt = new Map<string, number>();
  const settled = new Set<string>();
  /** 教學對局的 id：不計牌位，結束時記下這位學生看過教學了。 */
  const tutorialGames = new Set<string>();

  const socketOf = (token: string) => {
    const sid = sessions.get(token)?.socketId;
    return sid ? io.sockets.sockets.get(sid) : undefined;
  };
  const tokenOf = (game: GameState, pid: PlayerId) =>
    [...sessions.values()].find((x) => x.gameId === game.id && x.pid === pid)?.token;
  const accountOf = (s: Session | undefined): Account | undefined => (s?.accountId ? store.get(s.accountId) : undefined);
  const nicknameOf = (token: string) => accountOf(sessions.get(token))?.nickname ?? '玩家';

  function uniqueNickname() {
    for (let i = 0; i < 50; i++) {
      const n = randomNickname();
      if (!store.nicknameTaken(n)) return n;
    }
    return `${randomNickname()}${randomInt(10, 99)}`;
  }

  // ───────────── 對局結束：牌位結算 ─────────────

  function settle(game: GameState) {
    if (settled.has(game.id) || !game.over) return;
    settled.add(game.id);
    brains.delete(game.id);
    if (tutorialGames.has(game.id)) {
      // 教學：不計戰績與牌位；打完或中途離開都算看過了
      for (const pid of PIDS) {
        const token = tokenOf(game, pid);
        const s = token ? sessions.get(token) : undefined;
        const acc = accountOf(s);
        if (!token || !acc || s?.bot) continue;
        acc.tutorialDone = true;
        store.changed();
        const sock = socketOf(token);
        sock?.emit('profile', profileOf(acc));
        sock?.emit('tutorial_finished');
      }
      return;
    }
    const { winner } = game.over;
    if (winner === 'void') return;
    for (const pid of PIDS) {
      const token = tokenOf(game, pid);
      const acc = token ? accountOf(sessions.get(token)) : undefined;
      if (!token || !acc) continue;
      const outcome: Outcome = winner === 'draw' ? 'draw' : winner === pid ? 'win' : 'loss';
      const before = acc.points;
      acc.points = applyOutcome(before, outcome);
      acc.games++;
      if (outcome === 'win') acc.wins++;
      else if (outcome === 'loss') acc.losses++;
      else acc.draws++;
      for (const r of game.roundLog) {
        for (const e of r.entries) {
          if (e.judge !== pid || e.choice === 'hold') continue;
          acc.judged++;
          if (e.base > 0) acc.correct++;
        }
      }
      if (!acc.bot) acc.seenTopics = [...acc.seenTopics.filter((t) => !game.topicIds.includes(t)), ...game.topicIds].slice(-300);
      store.changed();
      const sock = socketOf(token);
      if (sock) {
        const change: RankChange = { gameId: game.id, before, after: acc.points, outcome };
        sock.emit('rank_update', change);
        sock.emit('profile', profileOf(acc));
      }
    }
  }

  function flush(game: GameState) {
    if (flushed.get(game.id) === game.version) return;
    flushed.set(game.id, game.version);
    const events = game.events.splice(0);
    const t = now();
    for (const pid of PIDS) {
      const token = tokenOf(game, pid);
      const sock = token ? socketOf(token) : undefined;
      if (!sock) continue;
      for (const e of events) if (e.to === 'all' || e.to === pid) sock.emit(e.name, e.payload ?? {});
      sock.emit('state_snapshot', view(game, pid, t));
    }
    if (game.over && !finishedAt.has(game.id)) {
      finishedAt.set(game.id, t);
      settle(game);
    }
  }

  // ───────────── 配對 ─────────────

  function removeFromQueue(token: string) {
    const i = queue.indexOf(token);
    if (i >= 0) queue.splice(i, 1);
    queuedAt.delete(token);
  }

  const waitLimit = new Map<string, number>();
  function enqueue(token: string, front = false) {
    if (queue.includes(token)) return;
    if (front) queue.unshift(token);
    else queue.push(token);
    // 每次排隊各自決定要等多久才改配電腦玩家，不讓等待秒數固定
    if (!queuedAt.has(token)) queuedAt.set(token, now());
    waitLimit.set(token, botWait ? botWait[0] + rng() * (botWait[1] - botWait[0]) : Infinity);
  }

  function offerMatch(tokens: [string, string], botReadyAt: number | null) {
    const m: PendingMatch = {
      id: randomUUID(),
      tokens,
      ready: new Set(),
      deadline: now() + content.config.timers_sec.match_confirm * 1000,
      botReadyAt,
    };
    pending.set(m.id, m);
    for (const [me, opp] of [tokens, [tokens[1], tokens[0]]]) {
      socketOf(me)?.emit('match_found', {
        matchId: m.id,
        opponentNickname: nicknameOf(opp),
        deadline: m.deadline,
        serverNow: now(),
      });
    }
  }

  function tryMatch() {
    // 只配對目前連線中的人
    for (let i = queue.length - 1; i >= 0; i--) if (!socketOf(queue[i])) removeFromQueue(queue[i]);
    while (queue.length >= 2) {
      const a = queue[0];
      const b = queue[1];
      removeFromQueue(a);
      removeFromQueue(b);
      offerMatch([a, b], null);
    }
  }

  /** 排隊太久沒有人：配一個電腦玩家，流程和真人配對完全一樣。 */
  function matchWithBot(token: string): boolean {
    const acc = accountOf(sessions.get(token));
    if (!acc) return false;
    const busy = new Set<string>();
    for (const s of sessions.values()) if (s.bot && s.accountId && (activeGame(s) || isPending(s.token))) busy.add(s.accountId);
    const bot = pickBot(store, acc.points, busy, rng);
    if (!bot) return false;
    const botToken = `bot-${bot.id}`;
    if (!sessions.has(botToken)) {
      sessions.set(botToken, { token: botToken, accountId: bot.id, socketId: null, gameId: null, pid: null, bot: true });
    }
    removeFromQueue(token);
    const order: [string, string] = rng() < 0.5 ? [token, botToken] : [botToken, token];
    const confirm = content.config.timers_sec.match_confirm * 1000;
    offerMatch(order, now() + Math.min(1000 + rng() * 2500, confirm * 0.6));
    return true;
  }

  const isPending = (token: string) => [...pending.values()].some((m) => m.tokens.includes(token));

  function startGame(m: PendingMatch) {
    pending.delete(m.id);
    const [a, b] = m.tokens;
    const id = randomUUID();
    const accA = accountOf(sessions.get(a));
    const accB = accountOf(sessions.get(b));
    const game = createGame({
      id,
      config: content.config,
      messages: content.messages,
      duels: content.duels,
      nicknames: [nicknameOf(a), nicknameOf(b)],
      seenTopics: [...(accA?.seenTopics ?? []), ...(accB?.seenTopics ?? [])],
      rng,
      now: now(),
    });
    games.set(id, game);
    Object.assign(sessions.get(a)!, { gameId: id, pid: 'p1' });
    Object.assign(sessions.get(b)!, { gameId: id, pid: 'p2' });
    m.tokens.forEach((token, i) => {
      const s = sessions.get(token)!;
      const acc = accountOf(s);
      if (s.bot && acc) brains.set(id, new BotBrain(game, PIDS[i], skillFor(acc, rng), rng));
    });
    flush(game);
  }

  function activeGame(s: Session | undefined): GameState | undefined {
    if (!s?.gameId) return undefined;
    const g = games.get(s.gameId);
    return g && !g.over ? g : undefined;
  }

  // ───────────── 老師頁 API（只接受這台電腦自己連進來） ─────────────

  app.use('/api/teacher', (req, res, next) => {
    if (!isLocalRequest(req)) {
      res.status(403).json({ error: '老師頁只能在執行伺服器的那台電腦上開啟' });
      return;
    }
    next();
  });
  app.use(express.json());
  app.get('/api/teacher/overview', (_req, res) => {
    const online = new Set<string>();
    for (const s of sessions.values()) if (s.socketId && s.accountId) online.add(s.accountId);
    const playing = [...games.values()].filter((g) => !g.over).length;
    res.json({
      urls: lanUrls(listeningPort),
      online: online.size,
      playing,
      feedback: store.feedbackAll(),
      accounts: store.all().map((a) => ({
        id: a.id,
        bot: Boolean(a.bot),
        grade: a.grade,
        classNo: a.classNo,
        seat: a.seat,
        name: a.name,
        nickname: a.nickname,
        points: a.points,
        tier: tierOf(a.points).name,
        wins: a.wins,
        losses: a.losses,
        draws: a.draws,
        games: a.games,
        accuracy: a.judged ? a.correct / a.judged : null,
        online: online.has(a.id),
        lastSeen: a.lastSeen,
      })),
    });
  });
  app.get('/api/teacher/feedback', (_req, res) => {
    res.json({ feedback: store.feedbackAll() });
  });
  app.post('/api/teacher/feedback/:id/delete', (req, res) => {
    if (!store.removeFeedback(String(req.params.id))) return void res.status(404).json({ error: '找不到這則回饋' });
    res.json({ ok: true });
  });
  app.post('/api/teacher/accounts/:id/nickname', (req, res) => {
    const acc = store.get(String(req.params.id));
    if (!acc) return void res.status(404).json({ error: '找不到這個帳號' });
    const nick = checkNickname(req.body?.nickname);
    if (typeof nick !== 'string') return void res.status(400).json(nick);
    if (store.nicknameTaken(nick, acc.id)) return void res.status(400).json({ error: '這個暱稱已經有人用了' });
    acc.nickname = nick;
    store.changed();
    for (const s of sessions.values()) if (s.accountId === acc.id) socketOf(s.token)?.emit('profile', profileOf(acc));
    res.json({ ok: true });
  });
  app.post('/api/teacher/accounts/:id/delete', (req, res) => {
    const id = String(req.params.id);
    if (!store.remove(id)) return void res.status(404).json({ error: '找不到這個帳號' });
    for (const s of sessions.values()) {
      if (s.accountId !== id) continue;
      removeFromQueue(s.token);
      s.accountId = null;
      socketOf(s.token)?.emit('logged_out', { reason: 'removed' });
    }
    res.json({ ok: true });
  });

  if (opts.staticDir && existsSync(opts.staticDir)) {
    app.use(express.static(opts.staticDir));
    app.get(/^(?!\/(socket\.io|api)\/).*/, (_req, res) => res.sendFile('index.html', { root: opts.staticDir }));
  }

  // ───────────── 連線 ─────────────

  io.on('connection', (socket: Socket) => {
    let session: Session | undefined;

    const attach = (s: Session) => {
      session = s;
      s.socketId = socket.id;
      const game = activeGame(s);
      if (game) {
        setConnected(game, s.pid!, true, now());
        flushed.delete(game.id);
        flush(game);
      }
      return game;
    };

    socket.on('hello', (msg: { token?: string } = {}) => {
      const token = typeof msg.token === 'string' && TOKEN_RE.test(msg.token) ? msg.token : randomUUID();
      let s = sessions.get(token);
      if (!s) {
        s = { token, accountId: null, socketId: null, gameId: null, pid: null, bot: false };
        sessions.set(token, s);
      }
      const prev = s.socketId ? io.sockets.sockets.get(s.socketId) : undefined;
      s.socketId = socket.id;
      if (prev && prev.id !== socket.id) prev.disconnect(true);
      const acc = accountOf(s);
      socket.emit('welcome', { token, profile: acc ? profileOf(acc) : null, inGame: Boolean(activeGame(s)) });
      attach(s);
    });

    socket.on('login', (msg: unknown) => {
      if (!session || activeGame(session)) return;
      const input = checkLogin(msg);
      if (typeof input === 'string') return void socket.emit('login_failed', { message: input });
      let acc = store.findStudent(input.grade, input.classNo, input.seat);
      // 帳號只看年級、班、座號；姓名以最新填的為準
      if (acc) acc.name = input.name;
      else acc = store.create({ ...input, nickname: uniqueNickname() }, now());
      acc.lastSeen = now();
      store.changed();
      // 同一個帳號已在別處登入（例如關掉瀏覽器後重新登入）：接手那個連線身分，才能回到原本的對局
      const other = [...sessions.values()].find((x) => x !== session && x.accountId === acc!.id);
      if (other) {
        const old = other.socketId ? io.sockets.sockets.get(other.socketId) : undefined;
        sessions.delete(session.token);
        other.socketId = socket.id;
        if (old && old.id !== socket.id) {
          old.emit('logged_out', { reason: 'elsewhere' });
          old.disconnect(true);
        }
        attach(other);
      } else {
        session.accountId = acc.id;
      }
      socket.emit('logged_in', { token: session!.token, profile: profileOf(acc), inGame: Boolean(activeGame(session)) });
    });

    // 填好年級班座號後帶入上次的姓名（電腦教室每次可能換電腦，所以存在伺服器）。
    // 每個連線每分鐘最多查 30 次，避免有人用程式把全校姓名掃一遍。
    let lookups: number[] = [];
    socket.on('lookup_name', (msg: unknown) => {
      const t = now();
      lookups = lookups.filter((x) => t - x < 60_000);
      if (lookups.length >= 30) return;
      lookups.push(t);
      const key = checkSeat(msg);
      if (typeof key === 'string') return;
      socket.emit('name_hint', { ...key, name: store.findStudent(key.grade, key.classNo, key.seat)?.name ?? '' });
    });

    socket.on('logout', () => {
      if (!session || activeGame(session)) return;
      removeFromQueue(session.token);
      session.accountId = null;
      socket.emit('logged_out', { reason: 'self' });
    });

    socket.on('set_nickname', (msg: { nickname?: unknown } = {}) => {
      const acc = accountOf(session);
      if (!acc) return;
      const nick = checkNickname(msg.nickname);
      if (typeof nick !== 'string') return void socket.emit('nickname_failed', { message: nick.error });
      if (store.nicknameTaken(nick, acc.id)) return void socket.emit('nickname_failed', { message: '這個暱稱已經有人用了' });
      acc.nickname = nick;
      store.changed();
      socket.emit('profile', profileOf(acc));
    });

    // 新手教學：和「教學小幫手」打 3 回合，不計牌位；計時放寬，慢慢看說明
    socket.on('start_tutorial', () => {
      const acc = accountOf(session);
      if (!session || !acc || activeGame(session)) return;
      removeFromQueue(session.token);
      const coach =
        store.all().find((a) => a.coach) ??
        store.create({ grade: 0, classNo: 0, seat: 0, name: '', nickname: '教學小幫手', bot: true, coach: true, games: 1 }, now());
      const coachToken = `bot-tutorial-${randomUUID()}`;
      const coachSession: Session = { token: coachToken, accountId: coach.id, socketId: null, gameId: null, pid: null, bot: true };
      sessions.set(coachToken, coachSession);
      const t = content.config.timers_sec;
      const id = randomUUID();
      const game = createGame({
        id,
        config: {
          ...content.config,
          max_rounds: 3,
          timers_sec: { ...t, select_message: 120, action: 240, round_result: 120, duel_answer: Math.max(t.duel_answer, 20) },
        },
        messages: content.messages,
        duels: content.duels,
        nicknames: [acc.nickname, coach.nickname],
        seenTopics: acc.seenTopics,
        rng,
        now: now(),
        tutorial: true,
      });
      games.set(id, game);
      tutorialGames.add(id);
      Object.assign(session, { gameId: id, pid: 'p1' });
      Object.assign(coachSession, { gameId: id, pid: 'p2' });
      brains.set(id, new BotBrain(game, 'p2', 0.85, rng, { simple: true, speed: 0.35 }));
      flush(game);
    });

    socket.on('submit_feedback', (msg: { text?: unknown } = {}) => {
      const acc = accountOf(session);
      if (!acc) return;
      const res = store.addFeedback(acc, msg.text, now());
      socket.emit('feedback_result', res);
    });

    socket.on('get_leaderboard', (msg: { scope?: string } = {}) => {
      const acc = accountOf(session);
      if (!acc) return;
      socket.emit('leaderboard', store.leaderboard(acc, msg.scope === 'class' ? 'class' : 'all'));
    });

    socket.on('queue_join', () => {
      if (!session || activeGame(session)) return;
      if (!accountOf(session)) return void socket.emit('login_required');
      session.gameId = null;
      session.pid = null;
      enqueue(session.token);
      socket.emit('matchmaking_started', { serverNow: now() });
      tryMatch();
    });

    socket.on('queue_leave', () => {
      if (session) removeFromQueue(session.token);
    });

    socket.on('match_ready', (msg: { matchId?: string } = {}) => {
      const m = msg.matchId ? pending.get(msg.matchId) : undefined;
      if (!session || !m || !m.tokens.includes(session.token)) return;
      m.ready.add(session.token);
      if (m.ready.size === 2) startGame(m);
    });

    const act = (build: (msg: any) => Action) => (msg: any = {}) => {
      const game = activeGame(session);
      if (!game || !session?.pid) return;
      const res = applyAction(game, session.pid, build(msg), now());
      if (!res.ok) socket.emit('action_rejected', { error: res.error, message: res.message });
      flush(game);
    };
    socket.on('select_message', act((m) => ({ type: 'select_message', messageId: String(m.messageId) })));
    socket.on('use_verify', act(() => ({ type: 'use_verify' })));
    socket.on('use_function', act((m) => ({ type: 'use_function', card: m.card as FunctionName })));
    socket.on('investigate_pick', act((m) => ({ type: 'investigate_pick', index: Number(m.index) })));
    socket.on('submit_judgement', act((m) => ({ type: 'submit_judgement', choice: m.choice as Choice })));
    socket.on('duel_answer', act((m) => ({ type: 'duel_answer', choice: m.choice })));
    socket.on('next_round_ready', act(() => ({ type: 'next_round_ready' })));
    socket.on('leave_game', act(() => ({ type: 'leave_game' })));

    socket.on('disconnect', () => {
      if (!session || session.socketId !== socket.id) return;
      session.socketId = null;
      removeFromQueue(session.token);
      const game = activeGame(session);
      if (game) {
        setConnected(game, session.pid!, false, now());
        flush(game);
      }
    });
  });

  // ───────────── 計時 ─────────────

  const timer = setInterval(() => {
    const t = now();
    for (const m of [...pending.values()]) {
      const botToken = m.tokens.find((x) => sessions.get(x)?.bot);
      if (botToken && m.botReadyAt !== null && t >= m.botReadyAt && !m.ready.has(botToken)) {
        m.ready.add(botToken);
        if (m.ready.size === 2) {
          startGame(m);
          continue;
        }
      }
      if (t < m.deadline) continue;
      pending.delete(m.id);
      for (const token of [...m.tokens].reverse()) {
        if (sessions.get(token)?.bot) continue;
        if (m.ready.has(token)) {
          enqueue(token, true);
          socketOf(token)?.emit('match_cancelled', { reason: 'opponent_not_ready' });
        } else {
          socketOf(token)?.emit('match_cancelled', { reason: 'not_ready' });
        }
      }
      tryMatch();
    }
    // 排隊太久沒有真人：改配電腦玩家
    if (botWait) {
      for (const token of [...queue]) {
        const since = queuedAt.get(token);
        if (since !== undefined && t - since >= (waitLimit.get(token) ?? Infinity) && socketOf(token)) matchWithBot(token);
      }
    }
    for (const game of games.values()) {
      const brain = brains.get(game.id);
      if (brain && !game.over) {
        const action = brain.step(t);
        if (action && !applyAction(game, brain.pid, action, t).ok) brain.rejected(action);
      }
      tick(game, t);
      flush(game);
      const done = finishedAt.get(game.id);
      if (done && t - done > 10 * 60 * 1000) {
        for (const [token, sess] of sessions) if (sess.bot && sess.gameId === game.id && token.startsWith('bot-tutorial-')) sessions.delete(token);
        games.delete(game.id);
        flushed.delete(game.id);
        finishedAt.delete(game.id);
        settled.delete(game.id);
        tutorialGames.delete(game.id);
      }
    }
  }, opts.tickMs ?? 200);

  return {
    http,
    io,
    games,
    store,
    listen: (port) =>
      new Promise((resolve) => {
        http.listen(port, () => {
          const addr = http.address();
          listeningPort = typeof addr === 'object' && addr ? addr.port : port;
          resolve(listeningPort);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        clearInterval(timer);
        store.flush();
        io.close();
        http.close(() => resolve());
      }),
  };
}
