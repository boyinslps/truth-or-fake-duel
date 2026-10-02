// 伺服器與前端共用的型別。規格見企畫書第 12 節。

export type PlayerId = 'p1' | 'p2';
export type Choice = 'true' | 'false' | 'hold';
export type FactRole = 'direct' | 'indirect' | 'context' | 'extra';
export type TrapType =
  | 'common_myth'
  | 'oversimplified'
  | 'absolute_claim'
  | 'hearsay'
  | 'counterintuitive_true'
  | 'plain_true';

export type FunctionName =
  | 'viral_spread'
  | 'investigate'
  | 'double'
  | 'careful'
  | 'reroll'
  | 'conservative'
  | 'direct_duel';
export type UtilityName = 'verify' | FunctionName;

export const FUNCTION_NAMES: FunctionName[] = [
  'viral_spread',
  'investigate',
  'double',
  'careful',
  'reroll',
  'conservative',
  'direct_duel',
];

export interface Source {
  name: string;
  url?: string;
}

export interface Fact {
  id: string;
  /** 舊格式的證據角色；議題組的資訊不分角色，可省略。 */
  role?: FactRole;
  content: string;
  icon?: string;
  source_name: string;
  source_url?: string;
}

/** 議題組（題庫的撰寫單位）：3 筆查證資訊 ↔ 3 則消息，每筆資訊是某則消息的關鍵證據。 */
export interface TopicMessage {
  id: string;
  statement: string;
  answer: boolean;
  difficulty: 1 | 2 | 3;
  trap_type: TrapType;
  /** 判斷這則消息的關鍵資訊 id（議題內）。 */
  key_facts: string[];
  explanation: string;
}

export interface Topic {
  id: string;
  title: string;
  category: string;
  facts: Fact[];
  messages: TopicMessage[];
}

/** 引擎使用的消息卡：由議題組展開，facts 是整個議題共用的資訊。 */
export interface MessageCard {
  id: string;
  topic_id: string;
  topic_title: string;
  key_facts: string[];
  statement: string;
  answer: boolean;
  category: string;
  difficulty: 1 | 2 | 3;
  trap_type: TrapType;
  facts: Fact[];
  explanation: string;
  sources: Source[];
}

export interface DuelQuestion {
  id: string;
  statement: string;
  answer: boolean;
  category: string;
  difficulty: 1 | 2;
  explanation: string;
  sources: Source[];
}

export interface GameConfig {
  target_score: number;
  max_rounds: number;
  /** 每局抽幾個議題；每個議題的消息都會發進雙方牌庫。 */
  topics_per_match: number;
  opening_hand: { message: number; verify: number; function: number };
  /** 手牌上限：已達上限就不抽卡。 */
  hand_limit: { message: number; utility: number };
  utility_deck: Record<UtilityName, number>;
  timers_sec: {
    select_message: number;
    reveal: number;
    action: number;
    duel_ready: number;
    duel_answer: number;
    duel_reveal: number;
    round_result: number;
    match_confirm: number;
  };
  disconnect_forfeit_sec: number;
  approved_icons: string[];
  categories: string[];
}

export interface UtilityCard {
  uid: string;
  name: UtilityName;
}

export type Phase = 'select_message' | 'reveal' | 'action' | 'duel' | 'round_result' | 'game_over';

/** 前端看得到的消息卡：自己的卡含答案，對手的卡不含。 */
export interface MessageView {
  id: string;
  topicId: string;
  topicTitle: string;
  statement: string;
  category: string;
  difficulty: 1 | 2 | 3;
  factCount: number;
  answer?: boolean;
}

export interface SharedInfoView {
  message: MessageView;
  revealed: Fact[];
}

export interface CardStatus {
  usable: boolean;
  reason?: string;
}

export interface JudgementEntry {
  judge: PlayerId;
  message: MessageCard;
  choice: Choice;
  base: number;
  final: number;
  doubled: boolean;
  conservative: boolean;
  /** 抽到的實用卡；對手的獎勵在前端只顯示為 hidden。 */
  reward: UtilityName | 'hidden' | null;
  /** 做了判斷卻沒抽到卡的原因。 */
  rewardNote: 'hand_full' | 'deck_empty' | null;
  revealedBeforeResolve: string[];
}

export interface DuelResult {
  question: DuelQuestion;
  initiator: PlayerId;
  answers: Partial<Record<PlayerId, { choice: boolean; at: number }>>;
  points: Record<PlayerId, number>;
}

export interface RoundResult {
  round: number;
  entries: JudgementEntry[];
  functionsUsed: Record<PlayerId, FunctionName[]>;
  duel: DuelResult | null;
  scores: Record<PlayerId, number>;
}

export interface DuelView {
  stage: 'ready' | 'answer' | 'reveal';
  initiatorIsMe: boolean;
  question: { statement: string; category: string } | null;
  myAnswer: boolean | null;
  opponentAnswered: boolean;
  result: DuelResult | null;
}

export interface GameOverInfo {
  winner: PlayerId | 'draw' | 'void';
  reason: 'score' | 'max_rounds' | 'forfeit' | 'disconnect' | 'void';
}

export interface PlayerView {
  gameId: string;
  you: PlayerId;
  round: number;
  /** 教學對局：不計牌位，畫面會跳出引導視窗。 */
  tutorial: boolean;
  maxRounds: number;
  targetScore: number;
  phase: Phase;
  deadline: number | null;
  serverNow: number;
  me: {
    nickname: string;
    score: number;
    messageHand: MessageView[];
    utilityHand: UtilityCard[];
    cardStatus: Record<string, CardStatus>;
    playedMessage: MessageView | null;
    selected: boolean;
    choice: Choice | null;
    locked: boolean;
    effects: { double: boolean; conservative: boolean; careful: boolean };
    functionsUsedThisRound: FunctionName[];
    messageDeckCount: number;
    utilityDeckCount: number;
    handLimit: { message: number; utility: number };
    pendingInvestigate: { count: number } | null;
    readyForNext: boolean;
  };
  opponent: {
    nickname: string;
    score: number;
    connected: boolean;
    selected: boolean;
    locked: boolean;
    functionsUsedCount: number;
    readyForNext: boolean;
    /** 對手手上的消息卡張數與消息牌庫張數（只用來畫牌背動畫，看不到內容）。 */
    messageHandCount: number;
    messageDeckCount: number;
  };
  /** 揭示後才有：對手的消息（我要判斷的）與我的消息（對手要判斷的）。 */
  sharedInfo: { opponentMessage: SharedInfoView; myMessage: SharedInfoView } | null;
  /** 本局資訊庫：每個議題目前公開的資訊（整局累積）。 */
  library: { topicId: string; title: string; category: string; factCount: number; facts: Fact[] }[];
  /** 本局用到的議題 id，前端記錄在這台電腦上，下次配對時優先避開。 */
  topicIds: string[];
  duel: DuelView | null;
  duelUsedThisRound: boolean;
  history: RoundResult[];
  gameOver: GameOverInfo | null;
}

// ───────────── 帳號、牌位、排行榜（企畫書第 18 節） ─────────────

/** 登入後前端看得到的自己的資料。 */
export interface ProfileView {
  nickname: string;
  grade: number;
  classNo: number;
  seat: number;
  name: string;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  /** 做出判斷（不含暫不判斷）的正確率；還沒判斷過是 null。 */
  accuracy: number | null;
  /** 看完（或跳過）新手教學了嗎；第一次登入會自動進入教學。 */
  tutorialDone: boolean;
}

/** 排行榜只顯示暱稱，不顯示班級座號與真實姓名。 */
export interface LeaderboardRow {
  rank: number;
  nickname: string;
  points: number;
  wins: number;
  games: number;
  me: boolean;
}

export interface LeaderboardView {
  scope: 'all' | 'class';
  rows: LeaderboardRow[];
  /** 自己不在前面幾名時，另外附上自己的那一列。 */
  mine: LeaderboardRow | null;
}

export interface RankChange {
  gameId: string;
  before: number;
  after: number;
  outcome: 'win' | 'loss' | 'draw';
}

export interface GameEvent {
  to: 'all' | PlayerId;
  name: string;
  payload?: unknown;
}
