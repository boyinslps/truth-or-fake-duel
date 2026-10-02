// 牌位規則、帳號資料檔、電腦玩家（企畫書第 18 節）。
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyOutcome, TIERS, tierOf } from '../shared/rank';
import { checkLogin, checkNickname, Store } from '../server/store';
import { BotBrain, ensureBots, pickBot } from '../server/bot';
import { applyAction, createGame, tick } from '../server/engine';
import { loadContent } from '../server/content';

/** 固定種子的亂數，讓測試結果可重現。 */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('牌位', () => {
  it('贏 +20、輸 −10、和 +5', () => {
    expect(applyOutcome(120, 'win')).toBe(140);
    expect(applyOutcome(120, 'loss')).toBe(110);
    expect(applyOutcome(120, 'draw')).toBe(125);
  });
  it('輸了不會掉出目前的牌位', () => {
    expect(applyOutcome(0, 'loss')).toBe(0);
    expect(applyOutcome(105, 'loss')).toBe(100);
    expect(tierOf(applyOutcome(250, 'loss')).name).toBe('查證員');
  });
  it('牌位門檻由低到高', () => {
    for (let i = 1; i < TIERS.length; i++) expect(TIERS[i].min).toBeGreaterThan(TIERS[i - 1].min);
    expect(tierOf(99).index).toBe(0);
    expect(tierOf(100).index).toBe(1);
    expect(tierOf(5000).index).toBe(TIERS.length - 1);
  });
});

describe('帳號', () => {
  it('登入欄位檢查', () => {
    expect(checkLogin({ grade: 5, classNo: 3, seat: 12, name: '王小明' })).toEqual({ grade: 5, classNo: 3, seat: 12, name: '王小明' });
    expect(typeof checkLogin({ grade: 7, classNo: 3, seat: 12, name: '王小明' })).toBe('string');
    expect(typeof checkLogin({ grade: 5, classNo: 3, seat: 0, name: '王小明' })).toBe('string');
    expect(typeof checkLogin({ grade: 5, classNo: 3, seat: 12, name: '<b>' })).toBe('string');
    expect(checkLogin({ grade: 5, classNo: 3, seat: 12 })).toEqual({ grade: 5, classNo: 3, seat: 12, name: '' });
    expect(checkNickname(' 閃電俠 ')).toBe('閃電俠');
    expect(checkNickname('')).toHaveProperty('error');
    expect(checkNickname('<script>')).toHaveProperty('error');
  });

  it('資料寫進檔案，重開後讀得回來', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'zj-')), 'players.json');
    const a = new Store(file);
    const acc = a.create({ grade: 5, classNo: 3, seat: 12, name: '王小明', nickname: '閃電俠' }, 1);
    acc.points = 140;
    a.changed();
    a.flush();
    expect(JSON.parse(readFileSync(file, 'utf8')).accounts).toHaveLength(1);
    const b = new Store(file);
    expect(b.findStudent(5, 3, 12)).toMatchObject({ name: '王小明', nickname: '閃電俠', points: 140 });
    expect(b.nicknameTaken('閃電俠')).toBe(true);
  });

  it('排行榜只有真人學生：電腦玩家不上榜、登入過就在榜上、班級榜只有同班', () => {
    const s = new Store(null);
    const rng = seeded(1);
    ensureBots(s, 1000, rng);
    const me = s.create({ grade: 5, classNo: 3, seat: 1, name: '王小明', nickname: 'A', games: 1, points: 20 }, 1);
    s.create({ grade: 5, classNo: 3, seat: 2, name: '陳小美', nickname: 'C', games: 0, points: 0 }, 2);
    const other = s.create({ grade: 5, classNo: 4, seat: 1, name: '李小華', nickname: 'B', games: 1, points: 40 }, 1);
    const all = s.leaderboard(me, 'all');
    expect(all.rows.map((r) => r.nickname)).toEqual(['B', 'A', 'C']);
    expect(JSON.stringify(all)).not.toContain('"bot"');
    expect(s.leaderboard(me, 'class').rows.map((r) => r.nickname)).toEqual(['A', 'C']);
    expect(s.leaderboard(other, 'class').rows.map((r) => r.nickname)).toEqual(['B']);
  });

  it('榜單最多 20 人，自己不在前 20 名時另外附上自己那一列', () => {
    const s = new Store(null);
    const players = Array.from({ length: 25 }, (_, i) => s.create({ grade: 4, classNo: 1, seat: i + 1, name: '', nickname: 'P' + i, games: 1, points: 300 - i * 10 }, i));
    const board = s.leaderboard(players[24], 'all');
    expect(board.rows).toHaveLength(20);
    expect(board.mine).toMatchObject({ nickname: 'P24', rank: 25 });
    expect(s.leaderboard(players[0], 'all').mine).toBeNull();
  });

  it('回饋：存進檔案、限制長度與頻率、可刪除', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'zj-')), 'players.json');
    const st = new Store(file);
    const acc = st.create({ grade: 5, classNo: 3, seat: 12, name: '王小明', nickname: '閃電俠' }, 1);
    expect(st.addFeedback(acc, '  ', 1000)).toMatchObject({ ok: false });
    expect(st.addFeedback(acc, 'x'.repeat(301), 1000)).toMatchObject({ ok: false });
    expect(st.addFeedback(acc, '倒數可以再大一點', 1000)).toEqual({ ok: true });
    expect(st.addFeedback(acc, '太快了', 2000)).toMatchObject({ ok: false });
    expect(st.addFeedback(acc, '第二則', 20_000)).toEqual({ ok: true });
    st.flush();
    const again = new Store(file);
    expect(again.feedbackAll().map((f) => f.text)).toEqual(['第二則', '倒數可以再大一點']);
    expect(again.feedbackAll()[0]).toMatchObject({ grade: 5, classNo: 3, seat: 12, nickname: '閃電俠' });
    expect(again.removeFeedback(again.feedbackAll()[0].id)).toBe(true);
    expect(again.feedbackAll()).toHaveLength(1);
  });
});

describe('電腦玩家', () => {
  it('產生的電腦玩家有戰績、暱稱不重複；配對時挑積分接近的', () => {
    const s = new Store(null);
    ensureBots(s, 1000, seeded(2));
    const bots = s.all().filter((a) => a.bot);
    expect(bots.length).toBeGreaterThanOrEqual(20);
    expect(new Set(bots.map((b) => b.nickname)).size).toBe(bots.length);
    for (const b of bots) expect(b.games).toBeGreaterThan(0);
    const picked = pickBot(s, 300, new Set(), () => 0)!;
    const closest = Math.min(...bots.map((b) => Math.abs(b.points - 300)));
    expect(Math.abs(picked.points - 300)).toBe(closest);
  });

  it('兩個電腦玩家在正常倒數下能自己打完整局，判斷有對有錯', () => {
    const content = loadContent();
    for (const seed of [3, 4, 5]) {
      const rng = seeded(seed);
      let now = 1_000_000;
      const game = createGame({
        id: `g${seed}`, config: content.config, messages: content.messages, duels: content.duels,
        nicknames: ['A', 'B'], rng, now,
      });
      const brains = [new BotBrain(game, 'p1', 0.6, rng), new BotBrain(game, 'p2', 0.7, rng)];
      let steps = 0;
      while (!game.over && steps < 200_000) {
        for (const b of brains) {
          const a = b.step(now);
          if (a && !applyAction(game, b.pid, a, now).ok) b.rejected(a);
        }
        tick(game, now);
        now += 200;
        steps++;
      }
      expect(game.over).not.toBeNull();
      expect(game.over!.reason).not.toBe('disconnect');
      const entries = game.roundLog.flatMap((r) => r.entries);
      expect(entries.length).toBeGreaterThan(0);
      // 大多數回合都在倒數結束前自己做出判斷，不是逾時被系統判成暫不判斷
      const decided = entries.filter((e) => e.choice !== 'hold').length;
      expect(decided / entries.length).toBeGreaterThan(0.4);
      const right = entries.filter((e) => e.base > 0).length;
      expect(right).toBeGreaterThan(0);
    }
  });
});
