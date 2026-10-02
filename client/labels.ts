import type { Choice, FactRole, FunctionName, Phase, UtilityName } from '../shared/types';

export const CARD_EFFECT: Record<UtilityName, string> = {
  verify: '公開對手消息的 1 筆查證資訊',
  viral_spread: '抽 1 張消息卡',
  investigate: '查看對手 1 張手牌；是消息卡就得 1 張查證卡',
  double: '本回合判斷的得失分 ×2',
  careful: '下一張查證卡公開 2 筆資訊',
  reroll: '把其他功能卡全部換成新的',
  conservative: '本回合判斷錯誤不扣分',
  direct_duel: '發動 10 秒搶答',
};

export const FUNCTION_ORDER: FunctionName[] = [
  'double',
  'conservative',
  'careful',
  'investigate',
  'viral_spread',
  'reroll',
  'direct_duel',
];

export const ROLE_LABEL: Record<FactRole, string> = {
  direct: '直接證據',
  indirect: '側面證據',
  context: '條件與限制',
  extra: '其他補充',
};

export const CHOICE_LABEL: Record<Choice, string> = {
  true: '是真的',
  false: '是假的',
  hold: '暫不判斷',
};

export const PHASE_LABEL: Record<Phase, string> = {
  select_message: '選擇要出的消息',
  reveal: '同時揭示',
  action: '查證與判斷',
  duel: '直接對決',
  round_result: '回合結算',
  game_over: '對局結束',
};
