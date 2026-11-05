import { describe, expect, it } from 'vitest';
import { allowedTierGap, pickPair, WIDEN_MS } from '../server/matchmaking';

const p = (points: number, waitedMs = 0) => ({ points, waitedMs });

describe('配對：強配強、弱配弱', () => {
  it('每 5 秒多放寬一個牌位', () => {
    expect(WIDEN_MS).toBe(5000);
    expect(allowedTierGap(0)).toBe(0);
    expect(allowedTierGap(4999)).toBe(0);
    expect(allowedTierGap(5000)).toBe(1);
    expect(allowedTierGap(12_000)).toBe(2);
  });

  it('同牌位的兩人馬上配對', () => {
    expect(pickPair([p(10), p(90)])).toEqual([0, 1]);
  });

  it('牌位不同、剛開始排隊：不配', () => {
    expect(pickPair([p(50), p(300)])).toBeNull();
  });

  it('等滿 5 秒後，相差一個牌位可以配；相差兩個牌位還不行', () => {
    expect(pickPair([p(50, 5000), p(120)])).toEqual([0, 1]);
    expect(pickPair([p(50, 5000), p(300)])).toBeNull();
    expect(pickPair([p(50, 10_000), p(300)])).toEqual([0, 1]);
  });

  it('有好幾個人時，挑積分最接近的兩個，而不是先排的兩個', () => {
    // 排隊順序：弱、強、弱、強；弱配弱、強配強
    expect(pickPair([p(10), p(710), p(30), p(730)])).toEqual([0, 2]);
    expect(pickPair([p(710), p(10), p(730), p(30)])).toEqual([0, 2]);
  });

  it('積分一樣近時，排得比較前面的優先', () => {
    expect(pickPair([p(100), p(110), p(120)])).toEqual([0, 1]);
  });

  it('一個人或沒人：不配', () => {
    expect(pickPair([])).toBeNull();
    expect(pickPair([p(0)])).toBeNull();
  });
});
