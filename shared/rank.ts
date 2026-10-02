// 牌位規則（企畫書第 18 節）：前後端共用。
export interface Tier {
  index: number;
  name: string;
  /** 進入這個牌位需要的積分。 */
  min: number;
  icon: string;
  color: string;
}

export const TIERS: Tier[] = [
  { index: 0, name: '見習記者', min: 0, icon: 'newspaper', color: '#7C9A88' },
  { index: 1, name: '查證新手', min: 100, icon: 'search', color: '#FF9F43' },
  { index: 2, name: '查證員', min: 250, icon: 'scan-search', color: '#5CC8FF' },
  { index: 3, name: '資深查證員', min: 450, icon: 'shield', color: '#F2FF3A' },
  { index: 4, name: '查核專家', min: 700, icon: 'award', color: '#00FF9C' },
  { index: 5, name: '事實守護者', min: 1000, icon: 'crown', color: '#C07CFF' },
];

export const POINTS = { win: 20, loss: -10, draw: 5 } as const;

export type Outcome = 'win' | 'loss' | 'draw';

export function tierOf(points: number): Tier {
  let t = TIERS[0];
  for (const x of TIERS) if (points >= x.min) t = x;
  return t;
}

/** 下一個牌位（已是最高就回傳 null）。 */
export const nextTier = (t: Tier): Tier | null => TIERS[t.index + 1] ?? null;

/** 一局結束後的新積分：輸了會扣分，但不會掉出目前的牌位（保級）。 */
export function applyOutcome(points: number, outcome: Outcome): number {
  const floor = tierOf(points).min;
  return Math.max(floor, points + POINTS[outcome]);
}
