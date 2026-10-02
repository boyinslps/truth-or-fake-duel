// 電腦玩家（企畫書第 18.4 節）：沒人可配對時上場，外觀與行為都要像真人。
// 只透過 view() 看到和真人一樣的畫面，再加上「知道答案、但按程度決定答對機率」來模擬判斷力。
import type { Choice, FunctionName, PlayerId, PlayerView } from '../shared/types';
import { tierOf } from '../shared/rank';
import { view, type Action, type GameState, type Rng } from './engine';
import type { Account, Store } from './store';

// 看起來像學生取的暱稱：一半是預設的「顏色＋動物」，一半是自己取的
const BOT_NICKNAMES = [
  '小熊軟糖', '閃電小子', '珍奶控', 'Leo', '布丁狗', '追風少年', '星星雨', 'Momo', '阿Ben', '西瓜汁',
  '綠色狐狸', '金色企鵝', '白色兔子', '紫色熊貓', '銀色老虎', '橘色鯨魚', '黃色烏龜', '紅色松鼠',
  '咖啡貓', 'Amy', '小太陽', '火箭少年', 'Kevin', '芒果冰', '七號球員', '雲朵朵', 'Joy', '大白鯊', '彩虹糖', '阿宏',
];
const BOT_COUNT = 24;

/** 確保有足夠的電腦玩家帳號；積分分散在前幾個牌位，戰績看起來像打過一陣子。 */
export function ensureBots(store: Store, now: number, rng: Rng) {
  const have = store.all().filter((a) => a.bot && !a.coach).length;
  const names = BOT_NICKNAMES.filter((n) => !store.nicknameTaken(n));
  for (let i = have; i < BOT_COUNT && names.length; i++) {
    const nickname = names.splice(Math.floor(rng() * names.length), 1)[0];
    const games = 4 + Math.floor(rng() * 22);
    const wins = Math.round(games * (0.35 + rng() * 0.35));
    const losses = games - wins;
    const points = Math.max(0, Math.min(620, wins * 20 - losses * 10 + Math.floor(rng() * 60)));
    const judged = games * 8;
    store.create(
      {
        grade: 0, classNo: 0, seat: 0, name: '', nickname, bot: true,
        points, wins, losses, games, judged, correct: Math.round(judged * (0.55 + rng() * 0.25)),
        createdAt: now - Math.floor(rng() * 30 * 86_400_000),
      },
      now,
    );
  }
}

/** 挑一個沒在對戰、積分跟玩家最接近的電腦玩家（前三名裡隨機，避免每次都是同一個）。 */
export function pickBot(store: Store, points: number, busy: Set<string>, rng: Rng): Account | undefined {
  const free = store
    .all()
    .filter((a) => a.bot && !a.coach && !busy.has(a.id))
    .sort((x, y) => Math.abs(x.points - points) - Math.abs(y.points - points));
  return free[Math.floor(rng() * Math.min(3, free.length))];
}

/** 判斷力：牌位越高越準（約 50%–80%），再加一點個人差異。 */
export function skillFor(a: Account, rng: Rng) {
  return Math.min(0.82, 0.5 + tierOf(a.points).index * 0.06 + (rng() - 0.5) * 0.06);
}

interface RoundPlan {
  round: number;
  verifies: number;
  verified: number;
  tried: Set<string>;
  choice: Choice | null;
}

export interface BrainOptions {
  /** 教學對手：只查證與判斷，不用功能卡、不發動對決，動作也比較快。 */
  simple?: boolean;
  /** 反應時間的倍率（1 = 一般學生的速度）。 */
  speed?: number;
}

export class BotBrain {
  private key = '';
  private at = 0;
  private plan: RoundPlan = { round: 0, verifies: 0, verified: 0, tried: new Set(), choice: null };

  constructor(
    readonly game: GameState,
    readonly pid: PlayerId,
    readonly skill: number,
    private rng: Rng,
    private opts: BrainOptions = {},
  ) {}

  /** 每個 tick 呼叫：時間到了就回傳要做的動作，否則回傳 null。 */
  step(now: number): Action | null {
    if (this.game.over) return null;
    const v = view(this.game, this.pid, now);
    const key = [
      v.round, v.phase, v.duel?.stage, v.me.selected, v.me.locked, v.me.readyForNext, v.me.utilityHand.length,
      v.sharedInfo?.opponentMessage.revealed.length, v.me.pendingInvestigate?.count, v.duel?.myAnswer,
    ].join('|');
    if (key !== this.key) {
      this.key = key;
      this.at = now + this.delay(v, now);
    }
    if (now < this.at) return null;
    const action = this.decide(v, now);
    this.at = now + 1200; // 同一個畫面狀態下不要連續出手
    return action;
  }

  /** 動作被拒絕時：記下來，下次不要再試同一招。 */
  rejected(action: Action) {
    if (action.type === 'use_function') this.plan.tried.add(action.card);
    if (action.type === 'use_verify') this.plan.tried.add('verify');
    this.at = 0;
  }

  private rand(a: number, b: number) {
    return (a + this.rng() * (b - a)) * 1000 * (this.opts.speed ?? 1);
  }

  /** 像真人一樣的反應時間；倒數很短時（例如測試）按比例縮短。 */
  private delay(v: PlayerView, now: number): number {
    const left = v.deadline ? Math.max(0, v.deadline - now) : 10_000;
    switch (v.phase) {
      case 'select_message':
        return Math.min(this.rand(3, 9), left * 0.6);
      case 'action':
        if (v.me.pendingInvestigate) return Math.min(this.rand(1.5, 3.5), left * 0.3);
        return Math.min(this.plan.round === v.round && this.plan.verified ? this.rand(3, 7) : this.rand(5, 11), left * 0.45);
      case 'duel':
        return Math.min(this.rand(2.2, 6.5), left * 0.7);
      case 'round_result':
        return Math.min(this.rand(4, 12), left * 0.5);
      default:
        return 500;
    }
  }

  private planFor(round: number): RoundPlan {
    if (this.plan.round !== round) {
      const verifies = this.rng() < 0.15 ? 0 : this.rng() < this.skill ? 2 : 1;
      this.plan = { round, verifies, verified: 0, tried: new Set(), choice: null };
    }
    return this.plan;
  }

  private decide(v: PlayerView, now: number): Action | null {
    const rng = this.rng;
    if (v.phase === 'select_message' && !v.me.selected && v.me.messageHand.length) {
      const hand = v.me.messageHand;
      // 程度好的比較會挑難判斷的消息出
      const pick = rng() < this.skill ? [...hand].sort((a, b) => b.difficulty - a.difficulty)[0] : hand[Math.floor(rng() * hand.length)];
      return { type: 'select_message', messageId: pick.id };
    }
    if (v.phase === 'round_result' && !v.me.readyForNext) return { type: 'next_round_ready' };
    if (v.phase === 'duel' && v.duel?.stage === 'answer' && v.duel.myAnswer === null) {
      const q = this.game.duels.find((d) => d.id === this.game.duel.active?.questionId);
      if (!q) return null;
      const right = rng() < Math.min(0.95, this.skill + 0.1);
      return { type: 'duel_answer', choice: right ? q.answer : !q.answer };
    }
    if (v.phase !== 'action' || v.me.locked || !v.sharedInfo) return null;

    if (v.me.pendingInvestigate) return { type: 'investigate_pick', index: Math.floor(rng() * v.me.pendingInvestigate.count) };
    const plan = this.planFor(v.round);
    const usable = (name: string) =>
      !plan.tried.has(name) && v.me.utilityHand.some((c) => c.name === name && v.me.cardStatus[c.uid]?.usable);
    const useFn = (card: FunctionName): Action => {
      plan.tried.add(card);
      return { type: 'use_function', card };
    };
    const left = v.deadline ? v.deadline - now : Infinity;
    const simple = Boolean(this.opts.simple);
    if (left > 5000) {
      if (!simple && !v.duelUsedThisRound && usable('direct_duel') && rng() < 0.3) return useFn('direct_duel');
      if (plan.verified < plan.verifies && usable('verify')) {
        if (!simple && usable('careful') && rng() < 0.3) return useFn('careful');
        plan.verified++;
        return { type: 'use_verify' };
      }
      if (simple) return { type: 'submit_judgement', choice: this.choose(v, plan) };
      if (usable('investigate') && rng() < 0.2) return useFn('investigate');
      const sure = this.confidence(v) >= 0.8;
      if (sure && usable('double') && rng() < 0.6) return useFn('double');
      if (!sure && usable('conservative') && rng() < 0.5) return useFn('conservative');
    }
    return { type: 'submit_judgement', choice: this.choose(v, plan) };
  }

  /** 查到越多、看到關鍵證據，越有把握。 */
  private confidence(v: PlayerView): number {
    const info = v.sharedInfo!.opponentMessage;
    const msg = this.game.messages.get(info.message.id);
    const ids = info.revealed.map((f) => f.id);
    const keyShown = Boolean(msg?.key_facts.some((k) => ids.includes(k)));
    return Math.min(0.97, this.skill + ids.length * 0.08 + (keyShown ? 0.25 : 0));
  }

  private choose(v: PlayerView, plan: RoundPlan): Choice {
    if (plan.choice) return plan.choice;
    const msg = this.game.messages.get(v.sharedInfo!.opponentMessage.message.id)!;
    const right: Choice = msg.answer ? 'true' : 'false';
    const wrong: Choice = msg.answer ? 'false' : 'true';
    const r = this.rng();
    const p = this.confidence(v);
    plan.choice = r < p ? right : this.rng() < 0.45 ? 'hold' : wrong;
    return plan.choice;
  }
}
