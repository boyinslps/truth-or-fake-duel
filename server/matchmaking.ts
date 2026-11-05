// 配對規則：強配強、弱配弱。排隊越久，可以接受的牌位差距越大。
import { tierOf } from '../shared/rank';

/** 每等這麼久（毫秒），可接受的牌位差距多放寬一個牌位。 */
export const WIDEN_MS = 5_000;

export interface Candidate {
  points: number;
  /** 已經排隊多久（毫秒）。 */
  waitedMs: number;
}

/** 這位玩家排隊 waitedMs 之後，願意接受相差幾個牌位的對手。 */
export const allowedTierGap = (waitedMs: number) => Math.floor(Math.max(0, waitedMs) / WIDEN_MS);

/**
 * 在排隊的人裡挑出一組可以配對的兩人（回傳他們在 cands 裡的索引），沒有就回 null。
 * 兩人牌位差距要在「等得比較久那位」的可接受範圍內；符合的組合裡挑積分最接近的，
 * 積分一樣近就挑排得比較前面的。cands 依排隊順序排列。
 */
export function pickPair(cands: Candidate[]): [number, number] | null {
  let best: [number, number] | null = null;
  let bestDiff = Infinity;
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const a = cands[i];
      const b = cands[j];
      const gap = Math.abs(tierOf(a.points).index - tierOf(b.points).index);
      if (gap > allowedTierGap(Math.max(a.waitedMs, b.waitedMs))) continue;
      const diff = Math.abs(a.points - b.points);
      if (diff < bestDiff) {
        best = [i, j];
        bestDiff = diff;
      }
    }
  }
  return best;
}
