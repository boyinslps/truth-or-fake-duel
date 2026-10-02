import { describe, expect, it } from 'vitest';
import { loadContent, validateContent } from '../server/content';
import { ICON_NAMES, CATEGORY_ICONS } from '../shared/icons';

const iconSet = new Set(ICON_NAMES);

describe('題庫驗證（企畫書 11.6）', () => {
  it('目前的題庫與設定全部通過', () => {
    expect(validateContent(loadContent(), iconSet)).toEqual([]);
  });

  it('30 個議題，每個議題 3 筆資訊 ↔ 3 則消息，每筆資訊都是某則消息的關鍵證據', () => {
    const { topics } = loadContent();
    expect(topics).toHaveLength(30);
    for (const t of topics) {
      expect(t.facts).toHaveLength(3);
      expect(t.messages).toHaveLength(3);
      const keys = new Set(t.messages.flatMap((m) => m.key_facts));
      for (const f of t.facts) expect(keys.has(f.id)).toBe(true);
    }
  });

  it('每個題目類別都有對應圖示', () => {
    for (const c of loadContent().config.categories) expect(iconSet.has(CATEGORY_ICONS[c])).toBe(true);
  });

  it('抓得到字數超過、資訊數量不對、沒被用到的資訊、圖示不在清單', () => {
    const c = structuredClone(loadContent());
    c.topics[0].facts[0].content = '很'.repeat(41);
    c.topics[1].facts.push({ id: 'extra_x', content: '多出來的資訊', source_name: '測試' });
    c.topics[2].messages.forEach((m) => (m.key_facts = [c.topics[2].facts[0].id]));
    c.topics[3].facts[0].icon = 'rocket';
    const errors = validateContent(c, iconSet).join('\n');
    expect(errors).toContain('超過 40 字');
    expect(errors).toContain('要剛好 3 筆');
    expect(errors).toContain('不是任何消息的關鍵證據');
    expect(errors).toContain('不在核准清單');
  });

  it('抓得到真消息配上假消息的陷阱類型、整個議題都是假消息', () => {
    const c = structuredClone(loadContent());
    const t = c.topics[0].messages.find((m) => m.answer)!;
    t.trap_type = 'common_myth';
    c.topics[4].messages.forEach((m) => {
      m.answer = false;
      m.trap_type = 'common_myth';
    });
    const errors = validateContent(c, iconSet).join('\n');
    expect(errors).toContain('trap_type 不符');
    expect(errors).toContain('至少要有 1 則真消息');
  });
});
