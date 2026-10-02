// 對局規則引擎：不碰網路，只處理狀態。伺服器與測試都直接呼叫這裡。
// 規則依據企畫書第 3–10 節。
import type {
  CardStatus,
  Choice,
  DuelQuestion,
  DuelResult,
  Fact,
  FunctionName,
  GameConfig,
  GameEvent,
  GameOverInfo,
  JudgementEntry,
  MessageCard,
  MessageView,
  Phase,
  PlayerId,
  PlayerView,
  RoundResult,
  UtilityCard,
  UtilityName,
} from '../shared/types';
import { FUNCTION_NAMES } from '../shared/types';

export type Rng = () => number;

type HandRef = { kind: 'message'; id: string } | { kind: 'utility'; uid: string; name: UtilityName };

export interface PlayerState {
  id: PlayerId;
  nickname: string;
  score: number;
  messageDeck: string[];
  messageHand: string[];
  messageDiscard: string[];
  utilityDeck: UtilityCard[];
  utilityHand: UtilityCard[];
  utilityDiscard: UtilityCard[];
  /** 最近抽到的 2 張實用卡的名稱，抽牌時用來避免連續抽到同一種。 */
  recentDraws: UtilityName[];
  playedMessage: string | null;
  judgement: { choice: Choice | null; lockedAt: number | null };
  effects: { double: boolean; conservative: boolean; careful: boolean };
  functionsUsedThisRound: FunctionName[];
  pendingInvestigate: { order: HandRef[] } | null;
  connected: boolean;
  disconnectedSince: number | null;
  readyForNext: boolean;
}

interface ActiveDuel {
  initiator: PlayerId;
  questionId: string;
  stage: 'ready' | 'answer' | 'reveal';
  answers: Partial<Record<PlayerId, { choice: boolean; at: number }>>;
}

export interface GameState {
  id: string;
  config: GameConfig;
  round: number;
  phase: Phase;
  phaseDeadline: number | null;
  pausedRemainingMs: number | null;
  players: Record<PlayerId, PlayerState>;
  /** 以議題 id 為鍵：整局累積公開的資訊 id。 */
  revealedFacts: Record<string, string[]>;
  /** 本局抽到的議題。 */
  topicIds: string[];
  duel: { usedThisRound: boolean; active: ActiveDuel | null; result: DuelResult | null };
  usedDuelQuestions: string[];
  roundLog: RoundResult[];
  pendingOver: GameOverInfo | null;
  over: GameOverInfo | null;
  events: GameEvent[];
  version: number;
  messages: Map<string, MessageCard>;
  duels: DuelQuestion[];
  rng: Rng;
  /** 教學對局：不計牌位，客戶端會跳出引導視窗。 */
  tutorial: boolean;
}

export type Action =
  | { type: 'select_message'; messageId: string }
  | { type: 'use_verify' }
  | { type: 'use_function'; card: FunctionName }
  | { type: 'investigate_pick'; index: number }
  | { type: 'submit_judgement'; choice: Choice }
  | { type: 'duel_answer'; choice: boolean }
  | { type: 'next_round_ready' }
  | { type: 'leave_game' };

export type ActionResult = { ok: true } | { ok: false; error: string; message: string };

const OK: ActionResult = { ok: true };
const fail = (error: string, message: string): ActionResult => ({ ok: false, error, message });

export const other = (p: PlayerId): PlayerId => (p === 'p1' ? 'p2' : 'p1');
const PIDS: PlayerId[] = ['p1', 'p2'];
const isFunction = (name: UtilityName): name is FunctionName => name !== 'verify';

export const FUNCTION_LABELS: Record<FunctionName, string> = {
  viral_spread: '網路風傳',
  investigate: '事先調查',
  double: '加倍',
  careful: '小心謹慎',
  reroll: '重新再來',
  conservative: '保守',
  direct_duel: '直接對決',
};

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function emit(s: GameState, to: GameEvent['to'], name: string, payload?: unknown) {
  s.events.push({ to, name, payload });
  s.version++;
}

// ───────────────────────────── 開局 ─────────────────────────────

export interface CreateGameOptions {
  id: string;
  config: GameConfig;
  messages: MessageCard[];
  duels: DuelQuestion[];
  nicknames: [string, string];
  rng: Rng;
  now: number;
  /** 兩位玩家的電腦上已看過的議題，發牌時優先避開。 */
  seenTopics?: string[];
  tutorial?: boolean;
}

/**
 * 以議題為單位發牌：優先抽這兩台電腦都沒看過的議題，每個議題的消息全部發下去，
 * 真假交錯分給雙方，讓兩副牌庫張數相同、真假接近各半。
 */
function dealByTopic(
  messages: MessageCard[],
  count: number,
  rng: Rng,
  seen: Set<string>,
): { decks: Record<PlayerId, string[]>; topicIds: string[] } {
  const byTopic = new Map<string, MessageCard[]>();
  for (const m of messages) byTopic.set(m.topic_id, [...(byTopic.get(m.topic_id) ?? []), m]);
  const topicIds = shuffle([...byTopic.keys()], rng)
    .sort((a, b) => Number(seen.has(a)) - Number(seen.has(b)))
    .slice(0, count);
  const pool = topicIds.flatMap((t) => byTopic.get(t)!);
  const decks: Record<PlayerId, string[]> = { p1: [], p2: [] };
  let turn: PlayerId = rng() < 0.5 ? 'p1' : 'p2';
  for (const answer of [true, false]) {
    for (const m of shuffle(pool.filter((x) => x.answer === answer), rng)) {
      decks[turn].push(m.id);
      turn = other(turn);
    }
  }
  for (const p of PIDS) shuffle(decks[p], rng);
  return { decks, topicIds };
}

function buildUtilityDeck(pid: PlayerId, config: GameConfig, rng: Rng): UtilityCard[] {
  const deck: UtilityCard[] = [];
  for (const [name, count] of Object.entries(config.utility_deck) as [UtilityName, number][]) {
    for (let i = 0; i < count; i++) deck.push({ uid: `${pid}_${name}_${i}`, name });
  }
  return shuffle(deck, rng);
}

export function createGame(o: CreateGameOptions): GameState {
  const { decks, topicIds } = dealByTopic(o.messages, o.config.topics_per_match, o.rng, new Set(o.seenTopics ?? []));
  const players = {} as Record<PlayerId, PlayerState>;
  PIDS.forEach((pid, i) => {
    players[pid] = {
      id: pid,
      nickname: o.nicknames[i],
      score: 0,
      messageDeck: decks[pid],
      messageHand: [],
      messageDiscard: [],
      utilityDeck: buildUtilityDeck(pid, o.config, o.rng),
      utilityHand: [],
      utilityDiscard: [],
      recentDraws: [],
      playedMessage: null,
      judgement: { choice: null, lockedAt: null },
      effects: { double: false, conservative: false, careful: false },
      functionsUsedThisRound: [],
      pendingInvestigate: null,
      connected: true,
      disconnectedSince: null,
      readyForNext: false,
    };
  });
  const s: GameState = {
    id: o.id,
    config: o.config,
    round: 0,
    phase: 'select_message',
    phaseDeadline: null,
    pausedRemainingMs: null,
    players,
    revealedFacts: {},
    topicIds,
    duel: { usedThisRound: false, active: null, result: null },
    usedDuelQuestions: [],
    roundLog: [],
    pendingOver: null,
    over: null,
    events: [],
    version: 0,
    messages: new Map(o.messages.map((m) => [m.id, m])),
    duels: o.duels,
    rng: o.rng,
    tutorial: Boolean(o.tutorial),
  };
  for (const pid of PIDS) {
    const p = players[pid];
    for (let i = 0; i < o.config.opening_hand.message; i++) drawMessage(s, p);
    for (let i = 0; i < o.config.opening_hand.verify; i++) drawTyped(s, p, 'verify');
    for (let i = 0; i < o.config.opening_hand.function; i++) drawTyped(s, p, 'function');
  }
  emit(s, 'all', 'game_started', { nicknames: o.nicknames });
  startRound(s, o.now);
  return s;
}

// ───────────────────────────── 抽牌 ─────────────────────────────

/** 手牌已達上限就不抽（企畫書 3.3）。 */
export function handFull(s: GameState, p: PlayerState, kind: 'message' | 'utility') {
  const limit = s.config.hand_limit[kind];
  return (kind === 'message' ? p.messageHand.length : p.utilityHand.length) >= limit;
}

function drawMessage(s: GameState, p: PlayerState): string | null {
  if (handFull(s, p, 'message')) {
    emit(s, p.id, 'hand_full', { kind: 'message' });
    return null;
  }
  const id = p.messageDeck.shift();
  if (!id) return null;
  p.messageHand.push(id);
  return id;
}

function reshuffleUtility(s: GameState, p: PlayerState) {
  p.utilityDeck.push(...p.utilityDiscard.splice(0));
  shuffle(p.utilityDeck, s.rng);
}

/** 手上同名卡的張數上限：查證卡 3 張、其他 2 張。達到上限就不再抽同一種（除非牌庫只剩這種）。 */
const DRAW_CAP: Partial<Record<UtilityName, number>> = { verify: 3 };

/**
 * 判斷獎勵：偽隨機抽 1 張實用卡，可能是查證卡或功能卡。
 * 不是單純的洗牌後抽牌頂：手上已經有的種類、剛剛才抽過的種類，抽中機率會明顯變低，
 * 所以不會一直抽到同一種卡（例如 4 張查證卡）。
 */
export function drawTop(s: GameState, p: PlayerState): UtilityCard | null {
  if (handFull(s, p, 'utility')) return null;
  if (!p.utilityDeck.length) reshuffleUtility(s, p);
  if (!p.utilityDeck.length) return null;
  const inHand = (n: UtilityName) => p.utilityHand.filter((c) => c.name === n).length;
  const recent = (n: UtilityName) => p.recentDraws.filter((x) => x === n).length;
  const weigh = () =>
    p.utilityDeck.map((c) => {
      const have = inHand(c.name);
      if (have >= (DRAW_CAP[c.name] ?? 2)) return 0;
      // 最近兩次抽到的都是這一種，這次就不再抽它
      if (p.recentDraws.length >= 2 && p.recentDraws.every((n) => n === c.name)) return 0;
      return (isFunction(c.name) ? 1.3 : 1) / ((1 + have) ** 2 * (1 + recent(c.name)));
    });
  let weights = weigh();
  // 牌庫裡剩下的全是已達上限的種類：把棄牌洗回牌庫，換進別種卡再抽
  if (!weights.some((w) => w > 0) && p.utilityDiscard.length) {
    reshuffleUtility(s, p);
    weights = weigh();
  }
  if (!weights.some((w) => w > 0)) weights = weights.map(() => 1);
  let r = s.rng() * weights.reduce((x, y) => x + y, 0);
  let idx = weights.findIndex((w) => (r -= w) < 0);
  if (idx < 0) idx = weights.length - 1;
  const [card] = p.utilityDeck.splice(idx, 1);
  p.utilityHand.push(card);
  p.recentDraws = [...p.recentDraws, card.name].slice(-2);
  return card;
}

/** 指定類型抽牌：從牌庫中隨機選一張該類型的牌（企畫書 3.3）。 */
function drawTyped(s: GameState, p: PlayerState, type: 'verify' | 'function', exclude: Set<string> = new Set()): UtilityCard | null {
  if (handFull(s, p, 'utility')) return null;
  const matches = (c: UtilityCard) => (type === 'verify' ? c.name === 'verify' : isFunction(c.name) && !exclude.has(c.name));
  let idxs = p.utilityDeck.flatMap((c, i) => (matches(c) ? [i] : []));
  if (!idxs.length && p.utilityDiscard.some(matches)) {
    reshuffleUtility(s, p);
    idxs = p.utilityDeck.flatMap((c, i) => (matches(c) ? [i] : []));
  }
  if (!idxs.length) return null;
  const idx = idxs[Math.floor(s.rng() * idxs.length)];
  const [card] = p.utilityDeck.splice(idx, 1);
  p.utilityHand.push(card);
  return card;
}

// ───────────────────────────── 階段轉換 ─────────────────────────────

function setPhase(s: GameState, phase: Phase, now: number, seconds: number | null) {
  s.phase = phase;
  s.phaseDeadline = seconds === null ? null : now + seconds * 1000;
  emit(s, 'all', 'phase_changed', { phase, deadline: s.phaseDeadline, round: s.round });
}

function startRound(s: GameState, now: number) {
  s.round++;
  for (const pid of PIDS) {
    const p = s.players[pid];
    if (p.playedMessage) p.messageDiscard.push(p.playedMessage);
    p.playedMessage = null;
    p.judgement = { choice: null, lockedAt: null };
    p.effects = { double: false, conservative: false, careful: false };
    p.functionsUsedThisRound = [];
    p.pendingInvestigate = null;
    p.readyForNext = false;
    if (drawMessage(s, p)) emit(s, pid, 'message_drawn');
  }
  s.duel = { usedThisRound: false, active: null, result: null };
  s.pausedRemainingMs = null;
  emit(s, 'all', 'round_started', { round: s.round });
  setPhase(s, 'select_message', now, s.config.timers_sec.select_message);
}

function toReveal(s: GameState, now: number) {
  for (const pid of PIDS) s.revealedFacts[topicOf(s, s.players[pid].playedMessage!)] ??= [];
  emit(s, 'all', 'messages_revealed');
  setPhase(s, 'reveal', now, s.config.timers_sec.reveal);
}

function toAction(s: GameState, now: number) {
  setPhase(s, 'action', now, s.config.timers_sec.action);
}

function bothLocked(s: GameState) {
  return PIDS.every((pid) => s.players[pid].judgement.lockedAt !== null);
}

function resolveRound(s: GameState, now: number) {
  const entries: JudgementEntry[] = [];
  for (const pid of PIDS) {
    const p = s.players[pid];
    const msg = s.messages.get(s.players[other(pid)].playedMessage!)!;
    const choice: Choice = p.judgement.choice ?? 'hold';
    const base = choice === 'hold' ? 0 : (choice === 'true') === msg.answer ? 1 : -1;
    let final = base;
    if (p.effects.double) final *= 2;
    if (p.effects.conservative && final < 0) final = 0;
    p.score += final;
    const full = choice !== 'hold' && handFull(s, p, 'utility');
    const reward = choice === 'hold' || full ? null : drawTop(s, p);
    if (reward) emit(s, pid, 'utility_card_drawn', { name: reward.name });
    if (full) emit(s, pid, 'hand_full', { kind: 'utility' });
    entries.push({
      judge: pid,
      message: msg,
      choice,
      base,
      final,
      doubled: p.effects.double,
      conservative: p.effects.conservative,
      reward: reward?.name ?? null,
      rewardNote: choice === 'hold' ? null : full ? 'hand_full' : reward ? null : 'deck_empty',
      revealedBeforeResolve: [...(s.revealedFacts[msg.topic_id] ?? [])],
    });
    p.pendingInvestigate = null;
  }
  // 結算只公開這則消息的關鍵資訊，議題裡其他資訊保持隱藏，留給之後同議題的消息。
  for (const pid of PIDS) {
    const msg = s.messages.get(s.players[pid].playedMessage!)!;
    const shown = s.revealedFacts[msg.topic_id];
    for (const k of msg.key_facts) if (!shown.includes(k)) shown.push(k);
  }
  for (const e of entries) {
    const shown = new Set(s.revealedFacts[e.message.topic_id]);
    e.message = { ...e.message, facts: e.message.facts.filter((f) => shown.has(f.id)) };
  }
  const result: RoundResult = {
    round: s.round,
    entries,
    functionsUsed: { p1: [...s.players.p1.functionsUsedThisRound], p2: [...s.players.p2.functionsUsedThisRound] },
    duel: s.duel.result,
    scores: { p1: s.players.p1.score, p2: s.players.p2.score },
  };
  s.roundLog.push(result);
  s.pendingOver = checkOver(s);
  emit(s, 'all', 'round_resolved', { round: s.round });
  setPhase(s, 'round_result', now, s.config.timers_sec.round_result);
}

/** 勝負（企畫書 5.3）：回合結算後有人達目標分且不同分即結束；達回合上限就比總分。 */
function checkOver(s: GameState): GameOverInfo | null {
  const a = s.players.p1.score;
  const b = s.players.p2.score;
  const leader: PlayerId | 'draw' = a === b ? 'draw' : a > b ? 'p1' : 'p2';
  if (Math.max(a, b) >= s.config.target_score && leader !== 'draw') return { winner: leader, reason: 'score' };
  if (s.round >= s.config.max_rounds) return { winner: leader, reason: 'max_rounds' };
  return null;
}

function advanceAfterResult(s: GameState, now: number) {
  if (s.pendingOver) finish(s, s.pendingOver);
  else startRound(s, now);
}

function finish(s: GameState, info: GameOverInfo) {
  s.over = info;
  s.pendingOver = null;
  s.duel.active = null;
  s.phase = 'game_over';
  s.phaseDeadline = null;
  emit(s, 'all', 'game_ended', info);
  emit(s, 'all', 'phase_changed', { phase: 'game_over', deadline: null, round: s.round });
}

// ───────────────────────────── 直接對決 ─────────────────────────────

function startDuel(s: GameState, pid: PlayerId, now: number) {
  let pool = s.duels.filter((q) => !s.usedDuelQuestions.includes(q.id));
  if (!pool.length) {
    s.usedDuelQuestions = [];
    pool = s.duels;
  }
  const q = pool[Math.floor(s.rng() * pool.length)];
  s.usedDuelQuestions.push(q.id);
  s.pausedRemainingMs = Math.max(0, (s.phaseDeadline ?? now) - now);
  s.duel.usedThisRound = true;
  s.duel.active = { initiator: pid, questionId: q.id, stage: 'ready', answers: {} };
  emit(s, 'all', 'direct_duel_started', { initiator: pid });
  setPhase(s, 'duel', now, s.config.timers_sec.duel_ready);
}

function duelToAnswer(s: GameState, now: number) {
  s.duel.active!.stage = 'answer';
  s.phaseDeadline = now + s.config.timers_sec.duel_answer * 1000;
  emit(s, 'all', 'duel_question_shown', { deadline: s.phaseDeadline });
}

/** 對決計分（企畫書 8.2）：答對且最快 +2、答對但較慢 +1、答錯或不作答 0。 */
function duelToReveal(s: GameState, now: number) {
  const d = s.duel.active!;
  const q = s.duels.find((x) => x.id === d.questionId)!;
  const points: Record<PlayerId, number> = { p1: 0, p2: 0 };
  const correct = PIDS.filter((pid) => d.answers[pid]?.choice === q.answer).sort(
    (a, b) => d.answers[a]!.at - d.answers[b]!.at,
  );
  correct.forEach((pid, i) => {
    points[pid] = i === 0 ? 2 : 1;
    s.players[pid].score += points[pid];
  });
  d.stage = 'reveal';
  s.duel.result = { question: q, initiator: d.initiator, answers: { ...d.answers }, points };
  s.phaseDeadline = now + s.config.timers_sec.duel_reveal * 1000;
  emit(s, 'all', 'direct_duel_ended', { points });
}

function duelEnd(s: GameState, now: number) {
  s.duel.active = null;
  s.phase = 'action';
  s.phaseDeadline = now + (s.pausedRemainingMs ?? 0);
  s.pausedRemainingMs = null;
  emit(s, 'all', 'phase_changed', { phase: 'action', deadline: s.phaseDeadline, round: s.round });
  if (bothLocked(s)) resolveRound(s, now);
}

// ───────────────────────────── 行動 ─────────────────────────────

function topicOf(s: GameState, messageId: string): string {
  return s.messages.get(messageId)!.topic_id;
}

function unrevealed(s: GameState, messageId: string): Fact[] {
  const shown = new Set(s.revealedFacts[topicOf(s, messageId)] ?? []);
  return s.messages.get(messageId)!.facts.filter((f) => !shown.has(f.id));
}

function opponentHandRefs(s: GameState, pid: PlayerId): HandRef[] {
  const o = s.players[other(pid)];
  return [
    ...o.messageHand.map((id) => ({ kind: 'message', id }) as HandRef),
    ...o.utilityHand.map((c) => ({ kind: 'utility', uid: c.uid, name: c.name }) as HandRef),
  ];
}

/** 功能卡能不能用、為什麼不能用。前端用它把按鈕變灰並顯示原因。 */
export function functionStatus(s: GameState, pid: PlayerId, name: FunctionName): CardStatus {
  const p = s.players[pid];
  if (s.phase !== 'action') return { usable: false, reason: '只能在行動與判斷階段使用' };
  if (p.judgement.lockedAt !== null) return { usable: false, reason: '已鎖定判斷' };
  if (p.functionsUsedThisRound.includes(name)) return { usable: false, reason: '同名卡本回合已使用過' };
  const oppMsg = s.players[other(pid)].playedMessage!;
  switch (name) {
    case 'viral_spread':
      if (handFull(s, p, 'message')) return { usable: false, reason: `消息手牌已達上限 ${s.config.hand_limit.message} 張` };
      return p.messageDeck.length ? { usable: true } : { usable: false, reason: '消息牌庫已經用完' };
    case 'investigate':
      return opponentHandRefs(s, pid).length ? { usable: true } : { usable: false, reason: '對手沒有手牌' };
    case 'careful':
      if (!p.utilityHand.some((c) => c.name === 'verify')) return { usable: false, reason: '手上沒有查證卡' };
      if (!unrevealed(s, oppMsg).length) return { usable: false, reason: '這個議題的資訊都已公開' };
      if (p.effects.careful) return { usable: false, reason: '效果已啟用' };
      return { usable: true };
    case 'reroll':
      return p.utilityHand.filter((c) => isFunction(c.name) && c.name !== 'reroll').length ||
        p.utilityHand.filter((c) => c.name === 'reroll').length > 1
        ? { usable: true }
        : { usable: false, reason: '手上沒有其他功能卡' };
    case 'direct_duel':
      return s.duel.usedThisRound ? { usable: false, reason: '本回合已經有過直接對決' } : { usable: true };
    default:
      return { usable: true };
  }
}

function verifyStatus(s: GameState, pid: PlayerId): CardStatus {
  const p = s.players[pid];
  if (s.phase !== 'action') return { usable: false, reason: '只能在行動與判斷階段使用' };
  if (p.judgement.lockedAt !== null) return { usable: false, reason: '已鎖定判斷' };
  if (!unrevealed(s, s.players[other(pid)].playedMessage!).length) return { usable: false, reason: '這個議題的資訊都已公開' };
  return { usable: true };
}

function useVerify(s: GameState, pid: PlayerId): ActionResult {
  const p = s.players[pid];
  const st = verifyStatus(s, pid);
  if (!st.usable) return fail('not_usable', st.reason!);
  const idx = p.utilityHand.findIndex((c) => c.name === 'verify');
  if (idx < 0) return fail('no_card', '手上沒有查證卡');
  const [card] = p.utilityHand.splice(idx, 1);
  p.utilityDiscard.push(card);
  const msgId = s.players[other(pid)].playedMessage!;
  const count = p.effects.careful ? 2 : 1;
  p.effects.careful = false;
  const pool = shuffle(unrevealed(s, msgId), s.rng).slice(0, count);
  (s.revealedFacts[topicOf(s, msgId)] ??= []).push(...pool.map((f) => f.id));
  emit(s, 'all', 'information_revealed', { messageId: msgId, factIds: pool.map((f) => f.id), by: pid });
  emit(s, other(pid), 'opponent_action', { kind: 'verify' });
  return OK;
}

function useFunction(s: GameState, pid: PlayerId, name: FunctionName, now: number): ActionResult {
  const p = s.players[pid];
  if (!FUNCTION_NAMES.includes(name)) return fail('bad_card', '沒有這張功能卡');
  const idx = p.utilityHand.findIndex((c) => c.name === name);
  if (idx < 0) return fail('no_card', `手上沒有「${FUNCTION_LABELS[name]}」`);
  const st = functionStatus(s, pid, name);
  if (!st.usable) return fail('not_usable', st.reason!);
  const [card] = p.utilityHand.splice(idx, 1);
  p.utilityDiscard.push(card);
  p.functionsUsedThisRound.push(name);

  switch (name) {
    case 'viral_spread':
      drawMessage(s, p);
      emit(s, pid, 'message_drawn');
      break;
    case 'investigate': {
      const order = shuffle(opponentHandRefs(s, pid), s.rng);
      p.pendingInvestigate = { order };
      emit(s, pid, 'investigate_prompt', { count: order.length });
      break;
    }
    case 'double':
      p.effects.double = true;
      break;
    case 'conservative':
      p.effects.conservative = true;
      break;
    case 'careful':
      p.effects.careful = true;
      break;
    case 'reroll': {
      const old = p.utilityHand.filter((c) => isFunction(c.name));
      p.utilityHand = p.utilityHand.filter((c) => !isFunction(c.name));
      p.utilityDeck.push(...old);
      shuffle(p.utilityDeck, s.rng);
      const oldNames = new Set(old.map((c) => c.name));
      for (const o of old) {
        const i = p.utilityDeck.findIndex((c) => isFunction(c.name) && !oldNames.has(c.name));
        const j = i >= 0 ? i : p.utilityDeck.findIndex((c) => c.uid === o.uid);
        p.utilityHand.push(p.utilityDeck.splice(j, 1)[0]);
      }
      break;
    }
    case 'direct_duel':
      startDuel(s, pid, now);
      return OK;
  }
  emit(s, 'all', 'function_used', { by: pid });
  emit(s, other(pid), 'opponent_action', { kind: 'function' });
  return OK;
}

function investigatePick(s: GameState, pid: PlayerId, index: number): ActionResult {
  const p = s.players[pid];
  if (!p.pendingInvestigate) return fail('no_pending', '沒有進行中的事先調查');
  if (s.phase !== 'action') return fail('bad_phase', '只能在行動與判斷階段翻牌');
  const ref = p.pendingInvestigate.order[index];
  if (!Number.isInteger(index) || !ref) return fail('bad_index', '請選擇一張牌');
  p.pendingInvestigate = null;
  let gotVerify = false;
  let handIsFull = false;
  let card: unknown;
  if (ref.kind === 'message') {
    const m = s.messages.get(ref.id)!;
    card = { kind: 'message', statement: m.statement, category: m.category, difficulty: m.difficulty };
    handIsFull = handFull(s, p, 'utility');
    gotVerify = drawTyped(s, p, 'verify') !== null;
  } else {
    card = { kind: 'utility', name: ref.name };
  }
  emit(s, pid, 'card_peeked', { card, gotVerify, handFull: handIsFull });
  emit(s, other(pid), 'peeked_notice');
  return OK;
}

function submitJudgement(s: GameState, pid: PlayerId, choice: Choice, now: number): ActionResult {
  const p = s.players[pid];
  if (s.phase !== 'action') return fail('bad_phase', '現在不能判斷');
  if (p.judgement.lockedAt !== null) return fail('locked', '已經鎖定判斷');
  if (!['true', 'false', 'hold'].includes(choice)) return fail('bad_choice', '判斷選項不正確');
  p.judgement = { choice, lockedAt: now };
  p.pendingInvestigate = null;
  emit(s, pid, 'judgement_submitted', { choice });
  emit(s, other(pid), 'opponent_action', { kind: 'locked' });
  if (bothLocked(s)) resolveRound(s, now);
  return OK;
}

export function applyAction(s: GameState, pid: PlayerId, action: Action, now: number): ActionResult {
  if (s.over) return fail('game_over', '對局已經結束');
  const p = s.players[pid];
  switch (action.type) {
    case 'select_message': {
      if (s.phase !== 'select_message') return fail('bad_phase', '現在不能選消息');
      if (p.playedMessage) return fail('already_selected', '這回合已經選過消息');
      const idx = p.messageHand.indexOf(action.messageId);
      if (idx < 0) return fail('no_card', '手上沒有這張消息卡');
      p.messageHand.splice(idx, 1);
      p.playedMessage = action.messageId;
      emit(s, pid, 'message_selected');
      emit(s, other(pid), 'opponent_action', { kind: 'selected' });
      if (s.players[other(pid)].playedMessage) toReveal(s, now);
      return OK;
    }
    case 'use_verify':
      return useVerify(s, pid);
    case 'use_function':
      if (s.phase !== 'action') return fail('bad_phase', '只能在行動與判斷階段使用');
      return useFunction(s, pid, action.card, now);
    case 'investigate_pick':
      return investigatePick(s, pid, action.index);
    case 'submit_judgement':
      return submitJudgement(s, pid, action.choice, now);
    case 'duel_answer': {
      const d = s.duel.active;
      if (s.phase !== 'duel' || !d || d.stage !== 'answer') return fail('bad_phase', '現在不能作答');
      if (d.answers[pid]) return fail('answered', '已經作答');
      if (typeof action.choice !== 'boolean') return fail('bad_choice', '作答選項不正確');
      d.answers[pid] = { choice: action.choice, at: now };
      emit(s, pid, 'direct_duel_answered');
      emit(s, other(pid), 'duel_opponent_answered');
      if (PIDS.every((x) => d.answers[x])) duelToReveal(s, now);
      return OK;
    }
    case 'next_round_ready': {
      if (s.phase !== 'round_result') return fail('bad_phase', '現在不能進入下一回合');
      p.readyForNext = true;
      emit(s, other(pid), 'opponent_action', { kind: 'ready' });
      if (PIDS.every((x) => s.players[x].readyForNext)) advanceAfterResult(s, now);
      return OK;
    }
    case 'leave_game':
      finish(s, { winner: other(pid), reason: 'forfeit' });
      return OK;
    default:
      return fail('bad_action', '不認得的操作');
  }
}

// ───────────────────────────── 計時與連線 ─────────────────────────────

export function setConnected(s: GameState, pid: PlayerId, connected: boolean, now: number) {
  const p = s.players[pid];
  if (p.connected === connected) return;
  p.connected = connected;
  p.disconnectedSince = connected ? null : now;
  emit(s, other(pid), connected ? 'opponent_reconnected' : 'opponent_disconnected');
}

/** 處理所有到期的倒數與斷線判負。伺服器每 200 毫秒呼叫一次。 */
export function tick(s: GameState, now: number) {
  if (s.over) return;
  const limit = s.config.disconnect_forfeit_sec * 1000;
  const gone = PIDS.filter((pid) => {
    const since = s.players[pid].disconnectedSince;
    return since !== null && now - since >= limit;
  });
  if (gone.length === 2) return finish(s, { winner: 'void', reason: 'void' });
  if (gone.length === 1) return finish(s, { winner: other(gone[0]), reason: 'disconnect' });

  for (let guard = 0; guard < 10 && s.phaseDeadline !== null && now >= s.phaseDeadline; guard++) {
    switch (s.phase) {
      case 'select_message':
        for (const pid of PIDS) {
          const p = s.players[pid];
          if (p.playedMessage || !p.messageHand.length) continue;
          const idx = Math.floor(s.rng() * p.messageHand.length);
          p.playedMessage = p.messageHand.splice(idx, 1)[0];
          emit(s, pid, 'message_selected', { auto: true });
        }
        toReveal(s, now);
        break;
      case 'reveal':
        toAction(s, now);
        break;
      case 'action':
        for (const pid of PIDS) {
          const p = s.players[pid];
          if (p.judgement.lockedAt === null) p.judgement = { choice: 'hold', lockedAt: now };
        }
        resolveRound(s, now);
        break;
      case 'duel': {
        const stage = s.duel.active?.stage;
        if (stage === 'ready') duelToAnswer(s, now);
        else if (stage === 'answer') duelToReveal(s, now);
        else duelEnd(s, now);
        break;
      }
      case 'round_result':
        advanceAfterResult(s, now);
        break;
    }
  }
}

// ───────────────────────────── 玩家視角 ─────────────────────────────

function messageView(s: GameState, id: string, withAnswer: boolean): MessageView {
  const m = s.messages.get(id)!;
  return {
    id: m.id,
    topicId: m.topic_id,
    topicTitle: m.topic_title,
    statement: m.statement,
    category: m.category,
    difficulty: m.difficulty,
    factCount: m.facts.length,
    ...(withAnswer ? { answer: m.answer } : {}),
  };
}

function revealedFactList(s: GameState, messageId: string): Fact[] {
  const m = s.messages.get(messageId)!;
  return (s.revealedFacts[m.topic_id] ?? []).map((fid) => m.facts.find((f) => f.id === fid)!);
}

/** 依玩家視角產生要送到前端的資料；沒公開的東西一律不放進來（企畫書第 9 節）。 */
export function view(s: GameState, pid: PlayerId, now: number): PlayerView {
  const me = s.players[pid];
  const opp = s.players[other(pid)];
  const revealed = me.playedMessage !== null && opp.playedMessage !== null && s.phase !== 'select_message';
  const cardStatus: Record<string, CardStatus> = {};
  for (const c of me.utilityHand) {
    cardStatus[c.uid] = c.name === 'verify' ? verifyStatus(s, pid) : functionStatus(s, pid, c.name);
  }
  const d = s.duel.active;
  const q = d ? s.duels.find((x) => x.id === d.questionId)! : null;
  return {
    gameId: s.id,
    you: pid,
    round: s.round,
    tutorial: s.tutorial,
    maxRounds: s.config.max_rounds,
    targetScore: s.config.target_score,
    phase: s.phase,
    deadline: s.phaseDeadline,
    serverNow: now,
    me: {
      nickname: me.nickname,
      score: me.score,
      messageHand: me.messageHand.map((id) => messageView(s, id, true)),
      utilityHand: me.utilityHand.map((c) => ({ ...c })),
      cardStatus,
      playedMessage: me.playedMessage ? messageView(s, me.playedMessage, true) : null,
      selected: me.playedMessage !== null,
      choice: me.judgement.choice,
      locked: me.judgement.lockedAt !== null,
      effects: { ...me.effects },
      functionsUsedThisRound: [...me.functionsUsedThisRound],
      messageDeckCount: me.messageDeck.length,
      utilityDeckCount: me.utilityDeck.length,
      handLimit: { ...s.config.hand_limit },
      pendingInvestigate: me.pendingInvestigate ? { count: me.pendingInvestigate.order.length } : null,
      readyForNext: me.readyForNext,
    },
    opponent: {
      nickname: opp.nickname,
      score: opp.score,
      connected: opp.connected,
      selected: opp.playedMessage !== null,
      locked: opp.judgement.lockedAt !== null,
      functionsUsedCount: opp.functionsUsedThisRound.length,
      readyForNext: opp.readyForNext,
      messageHandCount: opp.messageHand.length,
      messageDeckCount: opp.messageDeck.length,
    },
    sharedInfo: revealed
      ? {
          opponentMessage: { message: messageView(s, opp.playedMessage!, false), revealed: revealedFactList(s, opp.playedMessage!) },
          myMessage: { message: messageView(s, me.playedMessage!, true), revealed: revealedFactList(s, me.playedMessage!) },
        }
      : null,
    duel:
      d && q
        ? {
            stage: d.stage,
            initiatorIsMe: d.initiator === pid,
            question: d.stage === 'ready' ? null : { statement: q.statement, category: q.category },
            myAnswer: d.answers[pid]?.choice ?? null,
            opponentAnswered: Boolean(d.answers[other(pid)]),
            result: d.stage === 'reveal' ? s.duel.result : null,
          }
        : null,
    duelUsedThisRound: s.duel.usedThisRound,
    library: Object.entries(s.revealedFacts)
      .filter(([, ids]) => ids.length)
      .map(([topicId, ids]) => {
        const any = [...s.messages.values()].find((m) => m.topic_id === topicId)!;
        return {
          topicId,
          title: any.topic_title,
          category: any.category,
          factCount: any.facts.length,
          facts: ids.map((fid) => any.facts.find((f) => f.id === fid)!),
        };
      }),
    topicIds: [...s.topicIds],
    history: s.roundLog.map((r) => ({
      ...r,
      entries: r.entries.map((e) => (e.judge === pid || e.reward === null ? e : { ...e, reward: 'hidden' as const })),
    })),
    gameOver: s.over,
  };
}
