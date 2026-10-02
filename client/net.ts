// 連線與前端狀態。所有遊戲狀態都以伺服器的 state_snapshot 為準。
import { io, type Socket } from 'socket.io-client';
import { useSyncExternalStore } from 'react';
import type {
  Choice, DuelResult, FunctionName, LeaderboardView, PlayerView, ProfileView, RankChange, UtilityName,
} from '../shared/types';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'good';
}

export interface PeekResult {
  card: { kind: 'message'; statement: string; category: string } | { kind: 'utility'; name: UtilityName };
  gotVerify: boolean;
  handFull?: boolean;
}

/** 場景裡的像素粒子：在哪一區、什麼顏色。 */
export interface Burst {
  id: number;
  zone: 'my-hand' | 'opp-message' | 'facts' | 'my-message' | 'center';
  color: string;
  count: number;
}

export interface NetState {
  connected: boolean;
  token: string | null;
  /** 收到伺服器的 welcome 之後才知道有沒有登入。 */
  authReady: boolean;
  profile: ProfileView | null;
  loginError: string | null;
  /** 伺服器回報的「這個座號上次登記的姓名」，用來自動帶入。 */
  nameHint: { key: string; name: string } | null;
  nicknameError: string | null;
  leaderboard: LeaderboardView | null;
  showLeaderboard: boolean;
  /** 回饋視窗是否開著，以及最近一次送出的結果。 */
  feedbackOpen: boolean;
  feedbackResult: { ok: boolean; message?: string } | null;
  /** 遊戲中「教學」按鈕打開的玩法說明。 */
  helpOpen: boolean;
  /** 剛結束那一局的積分變化。 */
  rankChange: RankChange | null;
  matching: { since: number } | null;
  match: { matchId: string; opponentNickname: string; deadline: number; ready: boolean } | null;
  cancelled: string | null;
  view: PlayerView | null;
  clockOffset: number;
  toasts: Toast[];
  investigate: { count: number } | null;
  peek: PeekResult | null;
  /** 最近公開的查證資訊 id，用來播放掃描動畫。 */
  freshFacts: string[];
  bursts: Burst[];
  lastDuel: DuelResult | null;
}

let state: NetState = {
  connected: false,
  token: null,
  authReady: false,
  profile: null,
  loginError: null,
  nameHint: null,
  nicknameError: null,
  leaderboard: null,
  showLeaderboard: false,
  feedbackOpen: false,
  feedbackResult: null,
  helpOpen: false,
  rankChange: null,
  matching: null,
  match: null,
  cancelled: null,
  view: null,
  clockOffset: 0,
  toasts: [],
  investigate: null,
  peek: null,
  freshFacts: [],
  bursts: [],
  lastDuel: null,
};
const listeners = new Set<() => void>();
function set(patch: Partial<NetState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const useNet = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
export const getNet = () => state;

let toastId = 1;
export function toast(text: string, tone: Toast['tone'] = 'info') {
  const id = toastId++;
  set({ toasts: [...state.toasts, { id, text, tone }].slice(-4) });
  setTimeout(() => set({ toasts: state.toasts.filter((t) => t.id !== id) }), 3500);
}

function readToken(): string | null {
  try {
    return sessionStorage.getItem('zj_token');
  } catch {
    return null;
  }
}
function saveToken(token: string) {
  try {
    sessionStorage.setItem('zj_token', token);
  } catch {
    /* 私密模式等情況下不存也能玩，只是重新整理後無法重連 */
  }
}

const socket: Socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  set({ connected: true });
  socket.emit('hello', { token: readToken() });
});
socket.on('disconnect', () => set({ connected: false }));
socket.on('welcome', (w: { token: string; profile: ProfileView | null }) => {
  saveToken(w.token);
  set({ token: w.token, profile: w.profile, authReady: true });
});
socket.on('logged_in', (w: { token: string; profile: ProfileView }) => {
  saveToken(w.token);
  set({ token: w.token, profile: w.profile, loginError: null });
});
socket.on('name_hint', (h: { grade: number; classNo: number; seat: number; name: string }) =>
  set({ nameHint: { key: `${h.grade}-${h.classNo}-${h.seat}`, name: h.name } }),
);
socket.on('login_failed', (e: { message: string }) => set({ loginError: e.message }));
socket.on('login_required', () => set({ profile: null, matching: null }));
socket.on('logged_out', (e: { reason: string }) => {
  set({ profile: null, view: null, matching: null, match: null, showLeaderboard: false, rankChange: null });
  if (e.reason === 'elsewhere') toast('你的帳號在別的電腦登入了', 'warn');
  if (e.reason === 'removed') toast('老師已刪除這個帳號，請重新登入', 'warn');
});
socket.on('profile', (p: ProfileView) => set({ profile: p, nicknameError: null }));
socket.on('nickname_failed', (e: { message: string }) => set({ nicknameError: e.message }));
socket.on('leaderboard', (l: LeaderboardView) => set({ leaderboard: l }));
socket.on('rank_update', (r: RankChange) => set({ rankChange: r }));
socket.on('feedback_result', (r: { ok: boolean; message?: string }) => set({ feedbackResult: r }));
socket.on('matchmaking_started', () => set({ matching: { since: Date.now() }, cancelled: null }));
socket.on('match_found', (m: { matchId: string; opponentNickname: string; deadline: number; serverNow: number }) =>
  set({
    match: { matchId: m.matchId, opponentNickname: m.opponentNickname, deadline: m.deadline, ready: false },
    clockOffset: m.serverNow - Date.now(),
  }),
);
socket.on('match_cancelled', (m: { reason: string }) => {
  if (m.reason === 'opponent_not_ready') {
    set({ match: null, cancelled: '對手沒有按準備，已幫你重新排隊。' });
  } else {
    set({ match: null, matching: null, cancelled: '你沒有在時間內按準備，已離開配對。' });
  }
});
socket.on('state_snapshot', (v: PlayerView) => {
  const prev = state.view;
  const patch: Partial<NetState> = { view: v, clockOffset: v.serverNow - Date.now(), match: null, matching: null };
  if (prev && prev.round !== v.round) patch.freshFacts = [];
  if (v.duel?.result) patch.lastDuel = v.duel.result;
  set(patch);
});
socket.on('information_revealed', (e: { factIds: string[] }) => {
  set({ freshFacts: [...state.freshFacts, ...e.factIds] });
});
function addBurst(zone: Burst['zone'], color: string, count = 40) {
  set({ bursts: [...state.bursts, { id: toastId++, zone, color, count }].slice(-6) });
}
const FX = { verify: '#EAB308', function: '#8B5CF6', duel: '#DB2777', true: '#0EA5A4', false: '#E11D48', hold: '#94A3B8' };
socket.on('information_revealed', (e: { by: string }) => {
  addBurst(e.by === state.view?.you ? 'facts' : 'my-message', FX.verify, 36);
});
socket.on('function_used', (e: { by: string }) => {
  addBurst(e.by === state.view?.you ? 'my-hand' : 'opp-message', FX.function);
});
socket.on('direct_duel_started', () => addBurst('center', FX.duel, 90));
socket.on('judgement_submitted', (e: { choice: 'true' | 'false' | 'hold' }) => addBurst('opp-message', FX[e.choice], 50));
socket.on('hand_full', (e: { kind: 'message' | 'utility' }) => {
  const lim = state.view?.me.handLimit;
  toast(e.kind === 'message' ? `消息卡已滿 ${lim?.message ?? ''} 張` : `實用卡已滿 ${lim?.utility ?? ''} 張`, 'warn');
});
socket.on('investigate_prompt', (e: { count: number }) => set({ investigate: e, peek: null }));
socket.on('card_peeked', (e: PeekResult) => set({ peek: e, investigate: null }));
socket.on('peeked_notice', () => toast('對手偷看了你 1 張手牌', 'warn'));
// 抽到的實用卡會從牌庫飛進手牌，不另外跳提示
socket.on('opponent_disconnected', () => toast('對手斷線', 'warn'));
socket.on('opponent_reconnected', () => toast('對手已回來', 'info'));
socket.on('action_rejected', (e: { message: string }) => toast(e.message, 'warn'));

export const CARD_NAME: Record<UtilityName, string> = {
  verify: '查證卡',
  viral_spread: '網路風傳',
  investigate: '事先調查',
  double: '加倍',
  careful: '小心謹慎',
  reroll: '重新再來',
  conservative: '保守',
  direct_duel: '直接對決',
};

export const actions = {
  login: (form: { grade: number; classNo: number; seat: number; name: string }) => {
    set({ loginError: null });
    socket.emit('login', form);
  },
  lookupName: (form: { grade: number; classNo: number; seat: number }) => socket.emit('lookup_name', form),
  logout: () => socket.emit('logout'),
  /** 新手教學：和教學小幫手打 3 回合，不計牌位。 */
  startTutorial: () => {
    set({ view: null, cancelled: null, lastDuel: null, rankChange: null, showLeaderboard: false });
    socket.emit('start_tutorial');
  },
  openFeedback: () => set({ feedbackOpen: true, feedbackResult: null }),
  closeFeedback: () => set({ feedbackOpen: false, feedbackResult: null }),
  submitFeedback: (text: string) => {
    set({ feedbackResult: null });
    socket.emit('submit_feedback', { text });
  },
  openHelp: () => set({ helpOpen: true }),
  closeHelp: () => set({ helpOpen: false }),
  setNickname: (nickname: string) => {
    set({ nicknameError: null });
    socket.emit('set_nickname', { nickname });
  },
  openLeaderboard: (scope: 'all' | 'class' = 'all') => {
    set({ showLeaderboard: true });
    socket.emit('get_leaderboard', { scope });
  },
  closeLeaderboard: () => set({ showLeaderboard: false, leaderboard: null }),
  joinQueue: () => {
    set({ view: null, cancelled: null, lastDuel: null, rankChange: null });
    socket.emit('queue_join');
  },
  leaveQueue: () => {
    socket.emit('queue_leave');
    set({ matching: null, cancelled: null });
  },
  ready: () => {
    if (!state.match) return;
    socket.emit('match_ready', { matchId: state.match.matchId });
    set({ match: { ...state.match, ready: true } });
  },
  selectMessage: (messageId: string) => socket.emit('select_message', { messageId }),
  useVerify: () => socket.emit('use_verify'),
  useFunction: (card: FunctionName) => socket.emit('use_function', { card }),
  pick: (index: number) => socket.emit('investigate_pick', { index }),
  closePeek: () => set({ peek: null }),
  judge: (choice: Choice) => socket.emit('submit_judgement', { choice }),
  duelAnswer: (choice: boolean) => socket.emit('duel_answer', { choice }),
  nextRound: () => socket.emit('next_round_ready'),
  leaveGame: () => socket.emit('leave_game'),
  backHome: () => set({ view: null, lastDuel: null, rankChange: null }),
};

/** 依伺服器時鐘換算剩餘秒數。 */
export function remainingMs(deadline: number | null): number {
  if (!deadline) return 0;
  return Math.max(0, deadline - (Date.now() + state.clockOffset));
}
