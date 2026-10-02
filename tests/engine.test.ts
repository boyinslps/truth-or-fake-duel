import { describe, expect, it } from 'vitest';
import { loadContent } from '../server/content';
import { applyAction, createGame, drawTop, setConnected, tick, view, type GameState } from '../server/engine';
import type { Choice, FunctionName, PlayerId, UtilityCard } from '../shared/types';

const content = loadContent();
const T0 = 1_000_000;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newGame(seed = 1, seenTopics: string[] = []): GameState {
  return createGame({
    seenTopics,
    id: 'g',
    config: structuredClone(content.config),
    messages: content.messages,
    duels: content.duels,
    nicknames: ['藍色海豚', '橘色狐狸'],
    rng: mulberry32(seed),
    now: T0,
  });
}

const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(`${r.error}: ${r.message}`);
};

/** 雙方各出第一張消息並進入行動階段；回傳目前時間。 */
function toAction(s: GameState, t = T0): number {
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    ok(applyAction(s, pid, { type: 'select_message', messageId: s.players[pid].messageHand[0] }, t));
  }
  expect(s.phase).toBe('reveal');
  t += s.config.timers_sec.reveal * 1000;
  tick(s, t);
  expect(s.phase).toBe('action');
  return t;
}

/** 讓 pid 要判斷的消息（對手打出的）答案為 answer。 */
function forceOpponentAnswer(s: GameState, judge: PlayerId, answer: boolean) {
  const opp = s.players[judge === 'p1' ? 'p2' : 'p1'];
  const mine = s.messages.get(s.players[judge].playedMessage!)!;
  const msg = content.messages.find((m) => m.answer === answer && m.topic_id !== mine.topic_id)!;
  opp.playedMessage = msg.id;
  s.revealedFacts[msg.topic_id] ??= [];
}

function give(s: GameState, pid: PlayerId, ...names: UtilityCard['name'][]) {
  names.forEach((name, i) => s.players[pid].utilityHand.push({ uid: `test_${pid}_${name}_${i}_${Math.random()}`, name }));
}

describe('開局', () => {
  it('抽 10 個議題、每個議題 3 則消息全部發下去，雙方張數相同、真消息數差距不超過 1', () => {
    const s = newGame(7);
    const all = [
      ...s.players.p1.messageDeck,
      ...s.players.p1.messageHand,
      ...s.players.p2.messageDeck,
      ...s.players.p2.messageHand,
    ];
    expect(new Set(all).size).toBe(30);
    expect(s.topicIds).toHaveLength(10);
    expect(new Set(all.map((id) => s.messages.get(id)!.topic_id))).toEqual(new Set(s.topicIds));
    const trueCount = (pid: PlayerId) =>
      [...s.players[pid].messageDeck, ...s.players[pid].messageHand].filter((id) => s.messages.get(id)!.answer).length;
    expect(Math.abs(trueCount('p1') - trueCount('p2'))).toBeLessThanOrEqual(1);
    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      const p = s.players[pid];
      const ids = [...p.messageDeck, ...p.messageHand];
      expect(ids).toHaveLength(15);
      expect(p.messageHand).toHaveLength(3); // 開局 2 + 第 1 回合抽 1
      expect(p.utilityHand.filter((c) => c.name === 'verify')).toHaveLength(3);
      expect(p.utilityHand.filter((c) => c.name !== 'verify')).toHaveLength(1);
      expect(p.utilityDeck).toHaveLength(16);
    }
    expect(s.round).toBe(1);
    expect(s.phase).toBe('select_message');
  });

  it('每回合只自動補消息卡，不補實用卡', () => {
    const s = newGame(2);
    let t = toAction(s);
    const before = s.players.p1.utilityHand.length;
    ok(applyAction(s, 'p1', { type: 'submit_judgement', choice: 'hold' }, t));
    ok(applyAction(s, 'p2', { type: 'submit_judgement', choice: 'hold' }, t));
    ok(applyAction(s, 'p1', { type: 'next_round_ready' }, t));
    ok(applyAction(s, 'p2', { type: 'next_round_ready' }, t));
    expect(s.round).toBe(2);
    expect(s.players.p1.messageHand).toHaveLength(3);
    expect(s.players.p1.utilityHand).toHaveLength(before);
  });
});

describe('判斷與計分（企畫書第 5 節）', () => {
  const cases: [Choice, boolean, number, boolean][] = [
    ['true', true, 1, true],
    ['true', false, -1, true],
    ['false', false, 1, true],
    ['false', true, -1, true],
    ['hold', true, 0, false],
    ['hold', false, 0, false],
  ];
  for (const [choice, answer, delta, rewarded] of cases) {
    it(`選「${choice}」、消息為${answer ? '真' : '假'} → ${delta} 分，${rewarded ? '抽' : '不抽'}實用卡`, () => {
      const s = newGame(3);
      const t = toAction(s);
      forceOpponentAnswer(s, 'p1', answer);
      const hand = s.players.p1.utilityHand.length;
      ok(applyAction(s, 'p1', { type: 'submit_judgement', choice }, t));
      ok(applyAction(s, 'p2', { type: 'submit_judgement', choice: 'hold' }, t));
      expect(s.phase).toBe('round_result');
      expect(s.players.p1.score).toBe(delta);
      expect(s.players.p1.utilityHand.length).toBe(hand + (rewarded ? 1 : 0));
    });
  }

  it('加倍 ×2、保守把負分變 0，順序為先加倍再保守', () => {
    const run = (answer: boolean, fns: FunctionName[]) => {
      const s = newGame(4);
      const t = toAction(s);
      forceOpponentAnswer(s, 'p1', answer);
      give(s, 'p1', ...fns);
      for (const f of fns) ok(applyAction(s, 'p1', { type: 'use_function', card: f }, t));
      ok(applyAction(s, 'p1', { type: 'submit_judgement', choice: 'true' }, t));
      ok(applyAction(s, 'p2', { type: 'submit_judgement', choice: 'hold' }, t));
      return s.players.p1.score;
    };
    expect(run(true, ['double'])).toBe(2);
    expect(run(false, ['double'])).toBe(-2);
    expect(run(false, ['conservative'])).toBe(0);
    expect(run(true, ['conservative'])).toBe(1);
    expect(run(false, ['double', 'conservative'])).toBe(0);
    expect(run(true, ['double', 'conservative'])).toBe(2);
  });

  it('逾時未鎖定視為暫不判斷', () => {
    const s = newGame(5);
    let t = toAction(s);
    t += s.config.timers_sec.action * 1000;
    tick(s, t);
    expect(s.phase).toBe('round_result');
    const log = s.roundLog[0];
    expect(log.entries.map((e) => e.choice)).toEqual(['hold', 'hold']);
    expect(s.players.p1.score + s.players.p2.score).toBe(0);
  });

  it('選消息逾時由伺服器隨機選一張', () => {
    const s = newGame(6);
    ok(applyAction(s, 'p1', { type: 'select_message', messageId: s.players.p1.messageHand[0] }, T0));
    tick(s, T0 + s.config.timers_sec.select_message * 1000);
    expect(s.players.p2.playedMessage).not.toBeNull();
    expect(s.phase).toBe('reveal');
  });
});

describe('查證（企畫書第 6 節）', () => {
  it('每張查證卡公開 1 筆不重複的資訊，全部公開後不能再查', () => {
    const s = newGame(8);
    const t = toAction(s);
    const msg = s.messages.get(s.players.p2.playedMessage!)!;
    const before = s.revealedFacts[msg.topic_id].length;
    give(s, 'p1', ...Array(msg.facts.length + 1).fill('verify'));
    for (let i = before + 1; i <= msg.facts.length; i++) {
      ok(applyAction(s, 'p1', { type: 'use_verify' }, t));
      expect(new Set(s.revealedFacts[msg.topic_id]).size).toBe(i);
    }
    const r = applyAction(s, 'p1', { type: 'use_verify' }, t);
    expect(r.ok).toBe(false);
  });

  it('小心謹慎讓下一張查證卡公開 2 筆', () => {
    const s = newGame(9);
    const t = toAction(s);
    forceOpponentAnswer(s, 'p1', true);
    const topic = s.messages.get(s.players.p2.playedMessage!)!.topic_id;
    give(s, 'p1', 'careful');
    ok(applyAction(s, 'p1', { type: 'use_function', card: 'careful' }, t));
    ok(applyAction(s, 'p1', { type: 'use_verify' }, t));
    expect(s.revealedFacts[topic]).toHaveLength(2);
    ok(applyAction(s, 'p1', { type: 'use_verify' }, t));
    expect(s.revealedFacts[topic]).toHaveLength(3);
  });

  it('鎖定判斷後不能再查證或用功能卡', () => {
    const s = newGame(10);
    const t = toAction(s);
    give(s, 'p1', 'double');
    ok(applyAction(s, 'p1', { type: 'submit_judgement', choice: 'hold' }, t));
    expect(applyAction(s, 'p1', { type: 'use_verify' }, t).ok).toBe(false);
    expect(applyAction(s, 'p1', { type: 'use_function', card: 'double' }, t).ok).toBe(false);
  });
});

describe('功能卡（企畫書第 7 節）', () => {
  it('同名卡每回合最多用 1 張', () => {
    const s = newGame(11);
    const t = toAction(s);
    give(s, 'p1', 'double', 'double');
    ok(applyAction(s, 'p1', { type: 'use_function', card: 'double' }, t));
    const r = applyAction(s, 'p1', { type: 'use_function', card: 'double' }, t);
    expect(r).toMatchObject({ ok: false });
  });

  it('網路風傳：抽 1 張消息卡', () => {
    const s = newGame(12);
    const t = toAction(s);
    give(s, 'p1', 'viral_spread');
    const hand = s.players.p1.messageHand.length;
    const deck = s.players.p1.messageDeck.length;
    ok(applyAction(s, 'p1', { type: 'use_function', card: 'viral_spread' }, t));
    expect(s.players.p1.messageHand).toHaveLength(hand + 1);
    expect(s.players.p1.messageDeck).toHaveLength(deck - 1);
  });

  it('事先調查：翻到消息卡得 1 張查證卡、翻到實用卡不得；對手收到通知', () => {
    for (const want of ['message', 'utility'] as const) {
      const s = newGame(13);
      const t = toAction(s);
      give(s, 'p1', 'investigate');
      ok(applyAction(s, 'p1', { type: 'use_function', card: 'investigate' }, t));
      const order = s.players.p1.pendingInvestigate!.order;
      expect(order).toHaveLength(s.players.p2.messageHand.length + s.players.p2.utilityHand.length);
      const index = order.findIndex((r) => r.kind === want);
      const verifyBefore = s.players.p1.utilityHand.filter((c) => c.name === 'verify').length;
      s.events.length = 0;
      ok(applyAction(s, 'p1', { type: 'investigate_pick', index }, t));
      const verifyAfter = s.players.p1.utilityHand.filter((c) => c.name === 'verify').length;
      expect(verifyAfter - verifyBefore).toBe(want === 'message' ? 1 : 0);
      const peek = s.events.find((e) => e.name === 'card_peeked')!;
      expect(peek.to).toBe('p1');
      expect(JSON.stringify(peek.payload)).not.toContain('answer');
      expect(s.events.some((e) => e.name === 'peeked_notice' && e.to === 'p2')).toBe(true);
    }
  });

  it('重新再來：其他功能卡全部換成不同名的卡，數量不變，查證卡不動', () => {
    const s = newGame(14);
    const t = toAction(s);
    const p = s.players.p1;
    p.utilityHand = p.utilityHand.filter((c) => c.name === 'verify');
    give(s, 'p1', 'reroll', 'double', 'conservative');
    ok(applyAction(s, 'p1', { type: 'use_function', card: 'reroll' }, t));
    const fns = p.utilityHand.filter((c) => c.name !== 'verify').map((c) => c.name);
    expect(fns).toHaveLength(2);
    for (const n of fns) expect(['double', 'conservative']).not.toContain(n);
    expect(p.utilityHand.filter((c) => c.name === 'verify')).toHaveLength(3);
  });

  it('重新再來：手上沒有其他功能卡時不能用', () => {
    const s = newGame(15);
    const t = toAction(s);
    s.players.p1.utilityHand = [];
    give(s, 'p1', 'reroll');
    expect(applyAction(s, 'p1', { type: 'use_function', card: 'reroll' }, t).ok).toBe(false);
  });
});

describe('手牌上限（超過就不抽卡）', () => {
  it('實用卡手牌已滿：做出判斷也不抽卡，並記錄原因', () => {
    const s = newGame(50);
    const t = toAction(s);
    const p = s.players.p1;
    while (p.utilityHand.length < s.config.hand_limit.utility) give(s, 'p1', 'verify');
    ok(applyAction(s, 'p1', { type: 'submit_judgement', choice: 'true' }, t));
    ok(applyAction(s, 'p2', { type: 'submit_judgement', choice: 'hold' }, t));
    expect(p.utilityHand).toHaveLength(s.config.hand_limit.utility);
    const e = s.roundLog[0].entries.find((x) => x.judge === 'p1')!;
    expect(e.reward).toBeNull();
    expect(e.rewardNote).toBe('hand_full');
    expect(s.events.some((x) => x.name === 'hand_full' && x.to === 'p1')).toBe(true);
  });

  it('消息手牌已滿：回合開始不抽，網路風傳不能用', () => {
    const s = newGame(51);
    const t = toAction(s);
    const p = s.players.p1;
    while (p.messageHand.length < s.config.hand_limit.message) p.messageHand.push(p.messageDeck.shift()!);
    give(s, 'p1', 'viral_spread');
    expect(applyAction(s, 'p1', { type: 'use_function', card: 'viral_spread' }, t)).toMatchObject({ ok: false });
    ok(applyAction(s, 'p1', { type: 'submit_judgement', choice: 'hold' }, t));
    ok(applyAction(s, 'p2', { type: 'submit_judgement', choice: 'hold' }, t));
    ok(applyAction(s, 'p1', { type: 'next_round_ready' }, t));
    ok(applyAction(s, 'p2', { type: 'next_round_ready' }, t));
    expect(p.messageHand).toHaveLength(s.config.hand_limit.message);
  });

  it('事先調查翻到消息卡但實用卡手牌已滿：不給查證卡', () => {
    const s = newGame(52);
    const t = toAction(s);
    const p = s.players.p1;
    give(s, 'p1', 'investigate');
    ok(applyAction(s, 'p1', { type: 'use_function', card: 'investigate' }, t));
    while (p.utilityHand.length < s.config.hand_limit.utility) give(s, 'p1', 'verify');
    const index = p.pendingInvestigate!.order.findIndex((r) => r.kind === 'message');
    s.events.length = 0;
    ok(applyAction(s, 'p1', { type: 'investigate_pick', index }, t));
    expect(s.events.find((e) => e.name === 'card_peeked')!.payload).toMatchObject({ gotVerify: false, handFull: true });
  });
});

describe('直接對決（企畫書第 8 節）', () => {
  function startDuel(seed: number) {
    const s = newGame(seed);
    let t = toAction(s);
    t += 20_000; // 行動階段剩 25 秒
    give(s, 'p1', 'direct_duel');
    ok(applyAction(s, 'p1', { type: 'use_function', card: 'direct_duel' }, t));
    expect(s.phase).toBe('duel');
    expect(s.pausedRemainingMs).toBe(25_000);
    t += s.config.timers_sec.duel_ready * 1000;
    tick(s, t);
    expect(s.duel.active!.stage).toBe('answer');
    const answer = s.duels.find((q) => q.id === s.duel.active!.questionId)!.answer;
    return { s, t, answer };
  }

  it('答對且較快 +2、答對但較慢 +1', () => {
    const { s, t, answer } = startDuel(20);
    ok(applyAction(s, 'p2', { type: 'duel_answer', choice: answer }, t + 1000));
    ok(applyAction(s, 'p1', { type: 'duel_answer', choice: answer }, t + 2000));
    expect(s.players.p2.score).toBe(2);
    expect(s.players.p1.score).toBe(1);
  });

  it('答錯與不作答都是 0，只有答對的人 +2', () => {
    const { s, t, answer } = startDuel(21);
    ok(applyAction(s, 'p1', { type: 'duel_answer', choice: !answer }, t + 500));
    tick(s, t + s.config.timers_sec.duel_answer * 1000);
    expect(s.players.p1.score).toBe(0);
    expect(s.players.p2.score).toBe(0);
    const s2 = startDuel(22);
    ok(applyAction(s2.s, 'p1', { type: 'duel_answer', choice: !s2.answer }, s2.t + 500));
    ok(applyAction(s2.s, 'p2', { type: 'duel_answer', choice: s2.answer }, s2.t + 3000));
    expect(s2.s.players.p1.score).toBe(0);
    expect(s2.s.players.p2.score).toBe(2);
  });

  it('作答中看不到對手的答案；結束後恢復行動階段的剩餘時間', () => {
    const { s, t, answer } = startDuel(23);
    ok(applyAction(s, 'p1', { type: 'duel_answer', choice: answer }, t + 100));
    const v2 = view(s, 'p2', t + 100);
    expect(v2.duel!.opponentAnswered).toBe(true);
    expect(JSON.stringify(v2.duel)).not.toContain('"choice"');
    let now = t + s.config.timers_sec.duel_answer * 1000;
    tick(s, now);
    expect(s.duel.active!.stage).toBe('reveal');
    now += s.config.timers_sec.duel_reveal * 1000;
    tick(s, now);
    expect(s.phase).toBe('action');
    expect(s.phaseDeadline! - now).toBe(25_000);
  });

  it('每回合全場最多 1 場', () => {
    const { s, t } = startDuel(24);
    let now = t + s.config.timers_sec.duel_answer * 1000;
    tick(s, now);
    now += s.config.timers_sec.duel_reveal * 1000;
    tick(s, now);
    give(s, 'p2', 'direct_duel');
    expect(applyAction(s, 'p2', { type: 'use_function', card: 'direct_duel' }, now).ok).toBe(false);
  });
});

describe('勝負（企畫書 5.3）', () => {
  function playRound(s: GameState, t: number, scores?: [number, number]) {
    t = toAction(s, t);
    if (scores) {
      s.players.p1.score = scores[0];
      s.players.p2.score = scores[1];
    }
    ok(applyAction(s, 'p1', { type: 'submit_judgement', choice: 'hold' }, t));
    ok(applyAction(s, 'p2', { type: 'submit_judgement', choice: 'hold' }, t));
    ok(applyAction(s, 'p1', { type: 'next_round_ready' }, t));
    ok(applyAction(s, 'p2', { type: 'next_round_ready' }, t));
    return t;
  }

  it('回合結算後有人達 7 分且分數較高就結束', () => {
    const s = newGame(30);
    playRound(s, T0, [7, 3]);
    expect(s.phase).toBe('game_over');
    expect(s.over).toEqual({ winner: 'p1', reason: 'score' });
  });

  it('雙方都 ≥ 7 且同分時繼續下一回合', () => {
    const s = newGame(31);
    playRound(s, T0, [7, 7]);
    expect(s.phase).toBe('select_message');
    expect(s.round).toBe(2);
  });

  it('雙方都 ≥ 7 同分後，下一回合誰先領先誰就獲勝', () => {
    const s = newGame(34);
    const t = playRound(s, T0, [7, 7]);
    expect(s.over).toBeNull();
    playRound(s, t, [8, 7]);
    expect(s.over).toEqual({ winner: 'p1', reason: 'score' });
  });

  it('只有一方到 7 分、另一方還沒到，也是領先的人立刻獲勝', () => {
    const s = newGame(35);
    playRound(s, T0, [4, 7]);
    expect(s.over).toEqual({ winner: 'p2', reason: 'score' });
  });

  it('打滿 12 回合仍無人達 7 分就比總分，同分平手', () => {
    const s = newGame(32);
    let t = T0;
    for (let r = 1; r <= 12; r++) t = playRound(s, t, r === 12 ? [2, 2] : undefined);
    expect(s.over).toEqual({ winner: 'draw', reason: 'max_rounds' });
  });

  it('連續斷線 90 秒判負；雙方都斷線則作廢', () => {
    const s = newGame(33);
    setConnected(s, 'p2', false, T0);
    tick(s, T0 + 89_000);
    expect(s.over).toBeNull();
    tick(s, T0 + 90_000);
    expect(s.over).toEqual({ winner: 'p1', reason: 'disconnect' });
    const s2 = newGame(34);
    setConnected(s2, 'p1', false, T0);
    setConnected(s2, 'p2', false, T0);
    tick(s2, T0 + 90_000);
    expect(s2.over!.winner).toBe('void');
  });

  it('主動離開視為投降', () => {
    const s = newGame(35);
    ok(applyAction(s, 'p2', { type: 'leave_game' }, T0));
    expect(s.over).toEqual({ winner: 'p1', reason: 'forfeit' });
  });
});

describe('資訊權限（企畫書第 9 節）', () => {
  it('前端資料不含對手消息的答案、未公開的資訊、對手手牌', () => {
    const s = newGame(40);
    const t = toAction(s);
    give(s, 'p2', 'verify');
    ok(applyAction(s, 'p2', { type: 'use_verify' }, t));
    const v = view(s, 'p1', t);
    const json = JSON.stringify(v);
    const oppMsg = s.messages.get(s.players.p2.playedMessage!)!;
    expect(v.sharedInfo!.opponentMessage.message).not.toHaveProperty('answer');
    const shown = new Set(s.revealedFacts[oppMsg.topic_id]);
    for (const f of oppMsg.facts) if (!shown.has(f.id)) expect(json).not.toContain(f.content);
    for (const id of s.players.p2.messageHand) expect(json).not.toContain(s.messages.get(id)!.statement);
    for (const c of s.players.p2.utilityHand) expect(json).not.toContain(c.uid);
    expect(json).not.toContain(oppMsg.explanation);
    // 自己的消息被對手查證公開的那筆資訊要看得到
    expect(v.sharedInfo!.myMessage.revealed).toHaveLength(1);
  });

  it('回合結算只公開該則消息的關鍵資訊，其他資訊不外流；對手的獎勵卡名稱隱藏', () => {
    const s = newGame(41);
    const t = toAction(s);
    forceOpponentAnswer(s, 'p1', true);
    ok(applyAction(s, 'p1', { type: 'submit_judgement', choice: 'true' }, t));
    ok(applyAction(s, 'p2', { type: 'submit_judgement', choice: 'false' }, t));
    const v = view(s, 'p1', t);
    const msg = s.messages.get(s.players.p2.playedMessage!)!;
    const revealed = v.sharedInfo!.opponentMessage.revealed.map((f) => f.id);
    for (const k of msg.key_facts) expect(revealed).toContain(k);
    const hidden = msg.facts.filter((f) => !s.revealedFacts[msg.topic_id].includes(f.id));
    expect(hidden.length).toBeGreaterThan(0);
    const json = JSON.stringify(v);
    for (const f of hidden) expect(json).not.toContain(f.content);
    const oppEntry = v.history[0].entries.find((e) => e.judge === 'p2')!;
    expect(oppEntry.reward).toBe('hidden');
  });
});

describe('議題組：整局累積的資訊庫（企畫書第 6 節）', () => {
  it('查到的資訊整局保留：同議題的消息之後出現時，已公開的資訊直接顯示', () => {
    const s = newGame(60);
    let t = toAction(s);
    forceOpponentAnswer(s, 'p1', false);
    const first = s.messages.get(s.players.p2.playedMessage!)!;
    give(s, 'p1', 'verify');
    ok(applyAction(s, 'p1', { type: 'use_verify' }, t));
    const known = [...s.revealedFacts[first.topic_id]];
    ok(applyAction(s, 'p1', { type: 'submit_judgement', choice: 'hold' }, t));
    ok(applyAction(s, 'p2', { type: 'submit_judgement', choice: 'hold' }, t));
    ok(applyAction(s, 'p1', { type: 'next_round_ready' }, t));
    ok(applyAction(s, 'p2', { type: 'next_round_ready' }, t));
    // 下一回合對手打出同議題的另一則消息
    t = toAction(s, t);
    const sibling = content.messages.find((m) => m.topic_id === first.topic_id && m.id !== first.id)!;
    s.players.p2.playedMessage = sibling.id;
    const v = view(s, 'p1', t);
    const shown = v.sharedInfo!.opponentMessage.revealed.map((f) => f.id);
    for (const id of known) expect(shown).toContain(id);
    expect(v.library.find((x) => x.topicId === first.topic_id)).toBeTruthy();
  });

  it('發牌時優先抽這台電腦沒看過的議題', () => {
    const all = [...new Set(content.messages.map((m) => m.topic_id))];
    const seen = all.slice(0, 20);
    for (let seed = 70; seed < 80; seed++) {
      const s = newGame(seed, seen);
      for (const id of s.topicIds) expect(seen).not.toContain(id);
    }
  });
});

describe('完整對局', () => {
  it('隨機亂玩到結束都不會出錯', () => {
    for (let seed = 100; seed < 130; seed++) {
      const rng = mulberry32(seed * 7);
      const s = newGame(seed);
      let t = T0;
      for (let step = 0; step < 5000 && !s.over; step++) {
        t += 700;
        for (const pid of ['p1', 'p2'] as PlayerId[]) {
          const p = s.players[pid];
          const r = rng();
          if (s.phase === 'select_message' && !p.playedMessage && r < 0.5) {
            applyAction(s, pid, { type: 'select_message', messageId: p.messageHand[0] }, t);
          } else if (s.phase === 'action' && r < 0.3 && p.utilityHand.length) {
            const c = p.utilityHand[Math.floor(rng() * p.utilityHand.length)];
            if (c.name === 'verify') applyAction(s, pid, { type: 'use_verify' }, t);
            else applyAction(s, pid, { type: 'use_function', card: c.name }, t);
            if (p.pendingInvestigate) applyAction(s, pid, { type: 'investigate_pick', index: 0 }, t);
          } else if (s.phase === 'action' && r < 0.4) {
            applyAction(s, pid, { type: 'submit_judgement', choice: (['true', 'false', 'hold'] as Choice[])[Math.floor(rng() * 3)] }, t);
          } else if (s.phase === 'duel' && r < 0.4) {
            applyAction(s, pid, { type: 'duel_answer', choice: rng() < 0.5 }, t);
          } else if (s.phase === 'round_result' && r < 0.5) {
            applyAction(s, pid, { type: 'next_round_ready' }, t);
          }
          view(s, pid, t);
          expect(p.utilityHand.length).toBeLessThanOrEqual(s.config.hand_limit.utility);
          expect(p.messageHand.length).toBeLessThanOrEqual(s.config.hand_limit.message);
        }
        tick(s, t);
      }
      expect(s.over).not.toBeNull();
      expect(s.round).toBeLessThanOrEqual(12);
      for (const pid of ['p1', 'p2'] as PlayerId[]) {
        const p = s.players[pid];
        const all = [...p.utilityDeck, ...p.utilityHand, ...p.utilityDiscard].map((c) => c.uid);
        expect(new Set(all).size).toBe(20); // 實用卡不會憑空增減
      }
    }
  });
});


describe('功能卡偽隨機抽牌', () => {
  it('不會抽到第 4 張查證卡，也不會連續抽到同一種卡；整體種類分散', () => {
    let maxVerify = 0;
    let maxSameRun = 0;
    let kinds: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const s = newGame(seed);
      const p = s.players.p1;
      const drawn: string[] = [];
      for (let i = 0; i < 40; i++) {
        const c = drawTop(s, p);
        if (c) drawn.push(c.name);
        maxVerify = Math.max(maxVerify, p.utilityHand.filter((x) => x.name === 'verify').length);
        // 像真的在打：手牌多了就用掉一張
        if (p.utilityHand.length >= 6) p.utilityDiscard.push(...p.utilityHand.splice(Math.floor(s.rng() * p.utilityHand.length), 1));
      }
      let run = 1;
      for (let i = 1; i < drawn.length; i++) {
        run = drawn[i] === drawn[i - 1] ? run + 1 : 1;
        maxSameRun = Math.max(maxSameRun, run);
      }
      kinds.push(new Set(drawn.slice(0, 10)).size);
    }
    expect(maxVerify).toBeLessThanOrEqual(3);
    expect(maxSameRun).toBeLessThanOrEqual(2);
    expect(kinds.reduce((a, b) => a + b, 0) / kinds.length).toBeGreaterThan(3.5);
  });
});
