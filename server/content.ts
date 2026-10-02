// 題庫與設定的載入與驗證（企畫書 11.6）。驗證不通過時伺服器拒絕啟動。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { DuelQuestion, GameConfig, MessageCard, Topic } from '../shared/types';
import { FUNCTION_NAMES } from '../shared/types';
import { TOPICS } from '../content/topics';
import { DUELS } from '../content/duels';

const here = dirname(fileURLToPath(import.meta.url));

export function loadConfig(path = join(here, '..', 'content', 'config.json')): GameConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as GameConfig;
}

export interface Content {
  config: GameConfig;
  topics: Topic[];
  /** 由議題組展開的消息卡，引擎直接使用。 */
  messages: MessageCard[];
  duels: DuelQuestion[];
}

/** 把議題組展開成消息卡：同一議題的消息共用同一組查證資訊。 */
export function flattenTopics(topics: Topic[]): MessageCard[] {
  return topics.flatMap((t) =>
    t.messages.map((m) => ({
      id: m.id,
      topic_id: t.id,
      topic_title: t.title,
      key_facts: m.key_facts,
      statement: m.statement,
      answer: m.answer,
      category: t.category,
      difficulty: m.difficulty,
      trap_type: m.trap_type,
      facts: t.facts,
      explanation: m.explanation,
      sources: [...new Set(t.facts.map((f) => f.source_name))].map((name) => ({ name })),
    })),
  );
}

export function loadContent(configPath?: string): Content {
  return { config: loadConfig(configPath), topics: TOPICS, messages: flattenTopics(TOPICS), duels: DUELS };
}

const len = (s: string) => [...s].length;
const TRUE_TRAPS = new Set(['counterintuitive_true', 'plain_true']);
const FALSE_TRAPS = new Set(['common_myth', 'oversimplified', 'absolute_claim', 'hearsay']);

export const LIMITS = { statement: 25, fact: 40, factsPerTopic: 3, messagesPerTopic: 3 };

export function validateContent({ config, topics, duels }: Content, iconNames?: Set<string>): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const addId = (id: string) => {
    if (ids.has(id)) errors.push(`重複的 id：${id}`);
    ids.add(id);
  };
  const approved = new Set(config.approved_icons);
  if (iconNames) for (const icon of approved) if (!iconNames.has(icon)) errors.push(`核准圖示不存在於圖示庫：${icon}`);

  const factTexts = new Map<string, string>();
  const statements = new Map<string, string>();
  for (const t of topics) {
    const where = `議題 ${t.id}「${t.title}」`;
    addId(t.id);
    if (!t.title) errors.push(`${where} 沒有標題`);
    if (!config.categories.includes(t.category)) errors.push(`${where} 類別不在清單中：${t.category}`);
    if (t.facts.length !== LIMITS.factsPerTopic) errors.push(`${where} 查證資訊要剛好 ${LIMITS.factsPerTopic} 筆（目前 ${t.facts.length}）`);
    if (t.messages.length !== LIMITS.messagesPerTopic) errors.push(`${where} 消息要剛好 ${LIMITS.messagesPerTopic} 則（目前 ${t.messages.length}）`);
    const factIds = new Set(t.facts.map((f) => f.id));
    for (const f of t.facts) {
      addId(f.id);
      if (len(f.content) > LIMITS.fact) errors.push(`${where} 資訊 ${f.id} 超過 ${LIMITS.fact} 字（${len(f.content)}）`);
      if (!f.source_name) errors.push(`${where} 資訊 ${f.id} 沒有來源`);
      if (f.source_url !== undefined && !/^https:\/\//.test(f.source_url)) errors.push(`${where} 資訊 ${f.id} 來源網址格式錯誤`);
      if (f.icon && !approved.has(f.icon)) errors.push(`${where} 資訊 ${f.id} 圖示不在核准清單：${f.icon}`);
      const dup = factTexts.get(f.content);
      if (dup) errors.push(`${where} 資訊與 ${dup} 重複：${f.content}`);
      factTexts.set(f.content, f.id);
    }
    const usedKeys = new Set<string>();
    for (const m of t.messages) {
      const mw = `${where} 消息 ${m.id}`;
      addId(m.id);
      if (!m.statement) errors.push(`${mw} 沒有內容`);
      if (len(m.statement) > LIMITS.statement) errors.push(`${mw} 超過 ${LIMITS.statement} 字（${len(m.statement)}）`);
      if (![1, 2, 3].includes(m.difficulty)) errors.push(`${mw} 難度不是 1–3`);
      if (m.answer && !TRUE_TRAPS.has(m.trap_type)) errors.push(`${mw} 真消息的 trap_type 不符：${m.trap_type}`);
      if (!m.answer && !FALSE_TRAPS.has(m.trap_type)) errors.push(`${mw} 假消息的 trap_type 不符：${m.trap_type}`);
      if (!m.explanation) errors.push(`${mw} 沒有解釋`);
      if (!m.key_facts.length) errors.push(`${mw} 沒有指定關鍵資訊`);
      for (const k of m.key_facts) {
        if (!factIds.has(k)) errors.push(`${mw} 的關鍵資訊 ${k} 不在這個議題裡`);
        usedKeys.add(k);
      }
      const dup = statements.get(m.statement);
      if (dup) errors.push(`${mw} 和 ${dup} 內容重複`);
      statements.set(m.statement, m.id);
    }
    // 「3 筆查證 ↔ 3 則消息」：每筆資訊都要是某則消息的關鍵證據，查到的資訊不會白費。
    for (const f of t.facts) if (!usedKeys.has(f.id)) errors.push(`${where} 資訊 ${f.id} 不是任何消息的關鍵證據`);
    if (!t.messages.some((m) => m.answer)) errors.push(`${where} 至少要有 1 則真消息`);
    if (!t.messages.some((m) => !m.answer)) errors.push(`${where} 至少要有 1 則假消息`);
  }

  const messages = topics.flatMap((t) => t.messages);
  const trues = messages.filter((m) => m.answer).length;
  const ratio = messages.length ? trues / messages.length : 0;
  if (ratio < 0.35 || ratio > 0.65) errors.push(`真消息比例 ${(ratio * 100).toFixed(0)}% 偏離一半太多（應在 35%–65%）`);

  if (topics.length < config.topics_per_match) errors.push(`議題不足：每局要 ${config.topics_per_match} 個，只有 ${topics.length} 個`);
  const perPlayer = Math.floor((config.topics_per_match * LIMITS.messagesPerTopic) / 2);
  if (perPlayer < config.opening_hand.message + config.max_rounds) {
    errors.push(`每人消息牌庫 ${perPlayer} 張，不足以打滿回合上限（需 ≥ 開局張數 + 回合上限）`);
  }

  for (const q of duels) {
    const where = `對決題 ${q.id}`;
    addId(q.id);
    if (len(q.statement) > LIMITS.statement) errors.push(`${where} 題目超過 ${LIMITS.statement} 字（${len(q.statement)}）`);
    if (![1, 2].includes(q.difficulty)) errors.push(`${where} 難度只能是 1–2`);
    if (!config.categories.includes(q.category)) errors.push(`${where} 類別不在清單中：${q.category}`);
    if (!q.explanation) errors.push(`${where} 沒有解釋`);
    if (!q.sources.length || q.sources.some((s) => !s.name)) errors.push(`${where} 沒有來源`);
    const dup = statements.get(q.statement);
    if (dup) errors.push(`${where} 和消息 ${dup} 內容重複`);
  }
  if (duels.length < 1) errors.push('對決題庫是空的');

  const deck = config.utility_deck;
  for (const name of ['verify', ...FUNCTION_NAMES] as const) {
    if (!Number.isInteger(deck[name]) || deck[name] < 0) errors.push(`實用牌庫設定錯誤：${name}`);
  }
  const fnTotal = FUNCTION_NAMES.reduce((a, n) => a + deck[n], 0);
  const lim = config.hand_limit;
  if (!lim || !(lim.message >= 1) || !(lim.utility >= 1)) errors.push('手牌上限設定錯誤');
  else {
    if (config.opening_hand.message + 1 > lim.message) errors.push('消息手牌上限太小：至少要能放開局張數 + 1');
    if (config.opening_hand.verify + config.opening_hand.function > lim.utility) errors.push('實用卡手牌上限小於開局實用卡張數');
  }
  if (config.opening_hand.verify > deck.verify) errors.push('開局查證卡多於牌庫查證卡');
  if (config.opening_hand.function > fnTotal) errors.push('開局功能卡多於牌庫功能卡');
  return errors;
}
