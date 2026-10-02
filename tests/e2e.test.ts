// 端對端：啟動真的伺服器，用兩個 Socket.IO 客戶端自動配對並打完整局。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { createApp, type App } from '../server/app';
import { loadContent } from '../server/content';
import type { PlayerView, ProfileView } from '../shared/types';

const base = loadContent();
const content = {
  ...base,
  config: {
    ...base.config,
    timers_sec: { select_message: 1, reveal: 0.2, action: 1.5, duel_ready: 0.2, duel_answer: 0.5, duel_reveal: 0.2, round_result: 0.3, match_confirm: 2 },
    disconnect_forfeit_sec: 3,
  },
};

let app: App;
let url: string;

beforeAll(async () => {
  app = createApp({ content, tickMs: 50, botWaitMs: null });
  const port = await app.listen(0);
  url = `http://localhost:${port}`;
});
afterAll(() => app.close());

interface Bot {
  socket: Socket;
  token: string;
  snapshots: PlayerView[];
  last?: PlayerView;
  events: string[];
  rejected: string[];
}

let seatNo = 0;

function connect(token: string = randomUUID(), serverUrl = url): Promise<Bot> {
  return new Promise((resolve) => {
    const socket = io(serverUrl, { transports: ['websocket'], forceNew: true });
    const bot: Bot = { socket, token, snapshots: [], events: [], rejected: [] };
    socket.onAny((name) => bot.events.push(name));
    socket.on('state_snapshot', (v: PlayerView) => {
      bot.snapshots.push(v);
      bot.last = v;
    });
    socket.on('action_rejected', (e) => bot.rejected.push(e.message));
    socket.on('match_found', (m) => socket.emit('match_ready', { matchId: m.matchId }));
    socket.on('welcome', () => resolve(bot));
    socket.emit('hello', { token });
  });
}

/** 用班級座號姓名登入；不給座號就用一個新的。 */
function login(bot: Bot, form: { grade?: number; classNo?: number; seat?: number; name?: string } = {}) {
  const seat = form.seat ?? ++seatNo;
  return new Promise<{ ok: boolean; message?: string; profile?: ProfileView }>((resolve) => {
    bot.socket.once('logged_in', (m) => resolve({ ok: true, profile: m.profile }));
    bot.socket.once('login_failed', (m) => resolve({ ok: false, message: m.message }));
    bot.socket.emit('login', { grade: form.grade ?? 5, classNo: form.classNo ?? 3, seat, name: form.name ?? `測試學生${String.fromCharCode(0x4e00 + seat)}` });
  });
}

async function player(token?: string) {
  const b = await connect(token);
  const r = await login(b);
  expect(r.ok).toBe(true);
  return b;
}

/** 簡單機器人：出第一張消息、有查證卡就查一次、判斷「是真的」、對決答「真」。 */
function autoplay(bot: Bot) {
  bot.socket.on('state_snapshot', (v: PlayerView) => {
    const s = bot.socket;
    if (v.phase === 'select_message' && !v.me.selected) s.emit('select_message', { messageId: v.me.messageHand[0].id });
    if (v.phase === 'action' && !v.me.locked) {
      const verify = v.me.utilityHand.find((c) => c.name === 'verify' && v.me.cardStatus[c.uid]?.usable);
      const duel = v.me.utilityHand.find((c) => c.name === 'direct_duel' && v.me.cardStatus[c.uid]?.usable);
      if (duel) s.emit('use_function', { card: 'direct_duel' });
      else if (verify && v.sharedInfo!.opponentMessage.revealed.length === 0) s.emit('use_verify');
      else s.emit('submit_judgement', { choice: 'true' });
    }
    if (v.phase === 'duel' && v.duel?.stage === 'answer' && v.duel.myAnswer === null) s.emit('duel_answer', { choice: true });
    if (v.phase === 'round_result' && !v.me.readyForNext) s.emit('next_round_ready');
  });
}

const waitFor = (pred: () => boolean, ms = 60_000) =>
  new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (pred()) {
        clearInterval(t);
        resolve();
      } else if (Date.now() - start > ms) {
        clearInterval(t);
        reject(new Error('timeout'));
      }
    }, 20);
  });

describe('端對端對局', () => {
  it('兩個客戶端自動配對、打完整局、雙方看到同一個結果，且過程中沒有洩漏答案', async () => {
    const a = await player();
    const b = await player();
    autoplay(a);
    autoplay(b);
    a.socket.emit('queue_join');
    b.socket.emit('queue_join');
    await waitFor(() => a.last?.phase === 'game_over' && b.last?.phase === 'game_over');

    expect(a.events).toContain('match_found');
    expect(a.last!.gameOver).toEqual(b.last!.gameOver);
    expect(a.last!.me.score).toBe(b.last!.opponent.score);
    expect(a.last!.history.length).toBeGreaterThanOrEqual(1);

    // 在回合結算之前，對手的消息都不能帶答案或未公開的資訊內容
    for (const bot of [a, b]) {
      for (const v of bot.snapshots) {
        if (v.phase === 'round_result' || v.phase === 'game_over') continue;
        expect(v.sharedInfo?.opponentMessage.message.answer).toBeUndefined();
      }
    }
    const game = [...app.games.values()].find((g) => g.id === a.last!.gameId)!;
    for (const r of game.roundLog) {
      for (const e of r.entries) {
        const judgeBot = e.judge === a.last!.you ? a : b;
        const seenBefore = judgeBot.snapshots.filter((v) => v.round === r.round && v.phase === 'action');
        const hidden = e.message.facts.filter((f) => !e.revealedBeforeResolve.includes(f.id));
        for (const v of seenBefore) for (const f of hidden) expect(JSON.stringify(v)).not.toContain(f.content);
      }
    }
    a.socket.close();
    b.socket.close();
  });

  it('斷線後用同一個 token 重連，拿回原本的對局狀態', async () => {
    const a = await player();
    const b = await player();
    a.socket.emit('queue_join');
    b.socket.emit('queue_join');
    await waitFor(() => a.last?.phase === 'select_message' && b.last?.phase === 'select_message');
    const gameId = a.last!.gameId;
    const hand = a.last!.me.messageHand.map((m) => m.id);
    a.socket.close();
    await waitFor(() => b.last?.opponent.connected === false);
    const a2 = await connect(a.token);
    await waitFor(() => Boolean(a2.last));
    expect(a2.last!.gameId).toBe(gameId);
    expect(a2.last!.me.messageHand.map((m) => m.id)).toEqual(hand);
    await waitFor(() => b.last?.opponent.connected === true);
    a2.socket.close();
    b.socket.close();
  });

  it('配對後有人沒按準備：另一人回到佇列並收到通知', async () => {
    const a = await player();
    const b = await player();
    b.socket.off('match_found');
    a.socket.emit('queue_join');
    b.socket.emit('queue_join');
    await waitFor(() => a.events.includes('match_cancelled'), 5000);
    expect(b.events).toContain('match_cancelled');
    const c = await player();
    c.socket.emit('queue_join');
    await waitFor(() => Boolean(a.last) && Boolean(c.last), 5000);
    expect(a.last!.opponent.nickname).toBe(c.last!.me.nickname);
    for (const x of [a, b, c]) x.socket.close();
  });

  it('連續斷線超過時限判負', async () => {
    const a = await player();
    const b = await player();
    a.socket.emit('queue_join');
    b.socket.emit('queue_join');
    await waitFor(() => Boolean(a.last) && Boolean(b.last));
    b.socket.close();
    await waitFor(() => a.last?.phase === 'game_over', 10_000);
    expect(a.last!.gameOver).toEqual({ winner: a.last!.you, reason: 'disconnect' });
    a.socket.close();
  });
});

describe('登入、牌位、排行榜', () => {
  it('帳號只看年級班座號；姓名選填、以最新填的為準；登入前可查上次的姓名', async () => {
    const a = await connect();
    const r = await login(a, { grade: 4, classNo: 2, seat: 7, name: '林小華' });
    expect(r.ok).toBe(true);
    expect(r.profile).toMatchObject({ grade: 4, classNo: 2, seat: 7, name: '林小華', points: 0 });
    const pts = r.profile!.nickname;

    // 換一台電腦：先查到上次的姓名，再改成新的姓名登入，還是同一個帳號
    const b = await connect();
    const hint = new Promise<any>((res) => b.socket.once('name_hint', res));
    b.socket.emit('lookup_name', { grade: 4, classNo: 2, seat: 7 });
    expect(await hint).toMatchObject({ seat: 7, name: '林小華' });
    const again = await login(b, { grade: 4, classNo: 2, seat: 7, name: '林曉華' });
    expect(again.ok).toBe(true);
    expect(again.profile).toMatchObject({ name: '林曉華', nickname: pts });
    expect(app.store.all().filter((x) => x.grade === 4 && x.classNo === 2 && x.seat === 7)).toHaveLength(1);
    a.socket.close();
    b.socket.close();

    // 沒有登記過的座號查不到姓名；姓名可以留空
    const c = await connect();
    const none = new Promise<any>((res) => c.socket.once('name_hint', res));
    c.socket.emit('lookup_name', { grade: 4, classNo: 2, seat: 55 });
    expect((await none).name).toBe('');
    expect((await login(c, { grade: 9, classNo: 2, seat: 8, name: '' })).ok).toBe(false);
    const blank = await login(c, { grade: 4, classNo: 2, seat: 8, name: '' });
    expect(blank.ok).toBe(true);
    expect(blank.profile!.name).toBe('');
    c.socket.close();
  });

  it('暱稱可以自己改，但不能和別人重複', async () => {
    const a = await connect();
    await login(a, { grade: 4, classNo: 2, seat: 7, name: '林小華' });
    const b = await connect();
    expect((await login(b, { grade: 4, classNo: 2, seat: 8, name: '陳大明' })).ok).toBe(true);

    const changed = new Promise<ProfileView>((res) => a.socket.once('profile', res));
    a.socket.emit('set_nickname', { nickname: '真相獵人' });
    expect((await changed).nickname).toBe('真相獵人');
    const failed = new Promise<{ message: string }>((res) => b.socket.once('nickname_failed', res));
    b.socket.emit('set_nickname', { nickname: '真相獵人' });
    expect((await failed).message).toContain('有人用');
    a.socket.close();
    b.socket.close();
  });

  it('沒登入不能排隊', async () => {
    const a = await connect();
    const need = new Promise<void>((res) => a.socket.once('login_required', () => res()));
    a.socket.emit('queue_join');
    await need;
    a.socket.close();
  });

  it('打完一局更新積分與戰績；排行榜只給暱稱', async () => {
    const a = await player();
    const b = await player();
    const changes: Record<string, { before: number; after: number; outcome: string }> = {};
    a.socket.on('rank_update', (c) => (changes.a = c));
    b.socket.on('rank_update', (c) => (changes.b = c));
    autoplay(a);
    autoplay(b);
    a.socket.emit('queue_join');
    b.socket.emit('queue_join');
    await waitFor(() => Boolean(changes.a && changes.b));
    const winnerIsA = a.last!.gameOver!.winner === a.last!.you;
    const [w, l] = winnerIsA ? [changes.a, changes.b] : [changes.b, changes.a];
    if (a.last!.gameOver!.winner !== 'draw') {
      expect(w).toMatchObject({ outcome: 'win', after: w.before + 20 });
      expect(l.outcome).toBe('loss');
      expect(l.after).toBe(Math.max(0, l.before - 10));
    }

    const board = new Promise<any>((res) => a.socket.once('leaderboard', res));
    a.socket.emit('get_leaderboard', { scope: 'class' });
    const lb = await board;
    expect(lb.rows.some((r: any) => r.me)).toBe(true);
    const text = JSON.stringify(lb);
    expect(text).not.toContain('測試學生');
    expect(text).not.toMatch(/"(name|seat|classNo|grade)"/);
    a.socket.close();
    b.socket.close();
  });

  it('關掉瀏覽器後在別台電腦重新登入，回到原本的對局', async () => {
    const a = await connect();
    await login(a, { grade: 6, classNo: 1, seat: 30, name: '張小安' });
    const b = await player();
    a.socket.emit('queue_join');
    b.socket.emit('queue_join');
    await waitFor(() => Boolean(a.last) && Boolean(b.last));
    const gameId = a.last!.gameId;
    a.socket.close();
    const a2 = await connect();
    const r = await login(a2, { grade: 6, classNo: 1, seat: 30, name: '張小安' });
    expect(r.ok).toBe(true);
    await waitFor(() => Boolean(a2.last));
    expect(a2.last!.gameId).toBe(gameId);
    a2.socket.close();
    b.socket.close();
  });

  it('老師頁 API 在本機可以看到全部帳號、改暱稱', async () => {
    const res = await fetch(`${url}/api/teacher/overview`);
    expect(res.status).toBe(200);
    const data = await res.json();
    const target = data.accounts.find((x: any) => !x.bot && x.grade === 4 && x.classNo === 2 && x.seat === 7);
    expect(target).toBeTruthy();
    const ok = await fetch(`${url}/api/teacher/accounts/${target.id}/nickname`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '老師改的' }),
    });
    expect(ok.status).toBe(200);
    expect(app.store.get(target.id)!.nickname).toBe('老師改的');
  });
});

describe('電腦玩家', () => {
  let botApp: App;
  let botUrl: string;
  beforeAll(async () => {
    botApp = createApp({ content, tickMs: 50, botWaitMs: [300, 600] });
    botUrl = `http://localhost:${await botApp.listen(0)}`;
  });
  afterAll(() => botApp.close());

  it('排隊沒人時自動配到電腦玩家，流程和真人一樣，畫面上沒有任何電腦玩家的標記', async () => {
    const a = await connect(undefined, botUrl);
    expect((await login(a, { grade: 3, classNo: 4, seat: 5, name: '黃小美' })).ok).toBe(true);
    let found: any = null;
    a.socket.on('match_found', (m) => (found = m));
    let change: any = null;
    a.socket.on('rank_update', (c) => (change = c));
    autoplay(a);
    a.socket.emit('queue_join');
    await waitFor(() => a.last?.phase === 'game_over', 90_000);
    expect(found.opponentNickname).toBeTruthy();
    expect(a.last!.opponent.nickname).toBe(found.opponentNickname);
    for (const v of a.snapshots) {
      expect(v.opponent.connected).toBe(true);
      expect(JSON.stringify(v)).not.toMatch(/"(bot|isBot)"\s*:/);
    }
    // 電腦玩家真的有出牌、判斷
    const game = [...botApp.games.values()].find((g) => g.id === a.last!.gameId)!;
    expect(game.roundLog.length).toBeGreaterThan(0);
    await waitFor(() => Boolean(change));
    expect(['win', 'loss', 'draw']).toContain(change.outcome);
    // 電腦玩家有正常戰績，會出現在「全部」排行榜的計算裡，和一般玩家同一套規則
    const botAcc = botApp.store.all().find((x) => x.nickname === found.opponentNickname)!;
    expect(botAcc.bot).toBe(true);
    expect(botAcc.games).toBeGreaterThan(0);
    const board = new Promise<any>((res) => a.socket.once('leaderboard', res));
    a.socket.emit('get_leaderboard', { scope: 'all' });
    const lb = await board;
    // 電腦玩家不上排行榜
    expect(lb.rows.some((r: any) => r.nickname === found.opponentNickname)).toBe(false);
    expect(JSON.stringify(lb)).not.toMatch(/"bot"/);
    a.socket.close();
  }, 100_000);
});


describe('新手教學與回饋', () => {
  it('教學對局：和教學小幫手打 3 回合，不計牌位，結束後記為看過教學；功能卡不會抽成同一種', async () => {
    const a = await player();
    let finished = false;
    let profile: ProfileView | null = null;
    let rank = false;
    a.socket.on('tutorial_finished', () => (finished = true));
    a.socket.on('profile', (p) => (profile = p));
    a.socket.on('rank_update', () => (rank = true));
    autoplay(a);
    a.socket.emit('start_tutorial');
    await waitFor(() => a.last?.phase === 'game_over', 90_000);
    expect(a.last!.tutorial).toBe(true);
    expect(a.last!.opponent.nickname).toBe('教學小幫手');
    expect(a.last!.maxRounds).toBe(3);
    expect(a.last!.history.length).toBe(3);
    await waitFor(() => finished);
    expect(profile!.tutorialDone).toBe(true);
    expect(profile!.games).toBe(0);
    expect(rank).toBe(false);
    for (const v of a.snapshots) expect(v.me.utilityHand.filter((c) => c.name === 'verify').length).toBeLessThanOrEqual(4);
    a.socket.close();
  }, 100_000);

  it('回饋：沒登入不能寫；寫了以後老師頁看得到，可以刪除', async () => {
    const anon = await connect();
    const none = new Promise<void>((res) => setTimeout(res, 300));
    let got = false;
    anon.socket.on('feedback_result', () => (got = true));
    anon.socket.emit('submit_feedback', { text: '偷偷寫' });
    await none;
    expect(got).toBe(false);
    anon.socket.close();

    const a = await player();
    const res = new Promise<any>((r) => a.socket.once('feedback_result', r));
    a.socket.emit('submit_feedback', { text: '教學很清楚，希望倒數更大' });
    expect(await res).toEqual({ ok: true });
    const too = new Promise<any>((r) => a.socket.once('feedback_result', r));
    a.socket.emit('submit_feedback', { text: '再寫一則' });
    expect((await too).ok).toBe(false);

    const overview = await (await fetch(url + '/api/teacher/overview')).json();
    const mine = overview.feedback.find((f: any) => f.text.includes('教學很清楚'));
    expect(mine).toBeTruthy();
    const del = await fetch(url + '/api/teacher/feedback/' + mine.id + '/delete', { method: 'POST' });
    expect(del.status).toBe(200);
    const after = await (await fetch(url + '/api/teacher/overview')).json();
    expect(after.feedback.some((f: any) => f.id === mine.id)).toBe(false);
    a.socket.close();
  });
});
