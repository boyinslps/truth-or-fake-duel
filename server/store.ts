// 帳號資料（企畫書第 18 節）：存成一個 JSON 檔，放在老師電腦上。
// 寫檔先寫暫存檔再改名，避免寫到一半斷電把檔案弄壞。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LeaderboardRow, LeaderboardView, ProfileView } from '../shared/types';

export interface Account {
  id: string;
  grade: number;
  classNo: number;
  seat: number;
  name: string;
  nickname: string;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  /** 做出判斷的次數（不含暫不判斷）與其中答對的次數。 */
  judged: number;
  correct: number;
  seenTopics: string[];
  createdAt: number;
  lastSeen: number;
  /** 電腦玩家：只有老師頁看得到這個標記，絕不送到學生的畫面。 */
  bot?: boolean;
  /** 教學用的對手帳號（不是一般電腦玩家，不會被配對到正式對局）。 */
  coach?: boolean;
  tutorialDone?: boolean;
}

export interface FeedbackEntry {
  id: string;
  at: number;
  accountId: string;
  grade: number;
  classNo: number;
  seat: number;
  name: string;
  nickname: string;
  text: string;
}

interface FileShape {
  version: 1;
  accounts: Account[];
  feedback?: FeedbackEntry[];
}

const LEADERBOARD_SIZE = 20;
export const FEEDBACK_MAX_CHARS = 300;
const FEEDBACK_GAP_MS = 15_000;
const FEEDBACK_PER_ACCOUNT = 30;

export class Store {
  private accounts = new Map<string, Account>();
  private feedback: FeedbackEntry[] = [];
  private timer: NodeJS.Timeout | null = null;

  /** file 為 null 時只放在記憶體（測試用）。 */
  constructor(private file: string | null) {
    if (file && existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8')) as FileShape;
      for (const a of data.accounts ?? []) this.accounts.set(a.id, a);
      this.feedback = data.feedback ?? [];
    }
  }

  // ───────────── 回饋 ─────────────

  feedbackAll(): FeedbackEntry[] {
    return [...this.feedback].sort((a, b) => b.at - a.at);
  }

  /** 學生寫下對遊戲的意見；太頻繁或太多則回傳錯誤訊息。 */
  addFeedback(acc: Account, raw: unknown, now: number): { ok: true } | { ok: false; message: string } {
    const text = String(raw ?? '').trim().replace(/\r\n/g, '\n');
    if (!text) return { ok: false, message: '請先寫下你的想法' };
    if (text.length > FEEDBACK_MAX_CHARS) return { ok: false, message: `最多 ${FEEDBACK_MAX_CHARS} 個字` };
    const mine = this.feedback.filter((f) => f.accountId === acc.id);
    if (mine.some((f) => now - f.at < FEEDBACK_GAP_MS)) return { ok: false, message: '剛剛已經送出了，等一下再寫' };
    if (mine.length >= FEEDBACK_PER_ACCOUNT) return { ok: false, message: '回饋次數已達上限，謝謝你' };
    this.feedback.push({
      id: randomUUID(),
      at: now,
      accountId: acc.id,
      grade: acc.grade,
      classNo: acc.classNo,
      seat: acc.seat,
      name: acc.name,
      nickname: acc.nickname,
      text,
    });
    this.changed();
    return { ok: true };
  }

  removeFeedback(id: string): boolean {
    const n = this.feedback.length;
    this.feedback = this.feedback.filter((f) => f.id !== id);
    if (this.feedback.length !== n) this.changed();
    return this.feedback.length !== n;
  }

  all(): Account[] {
    return [...this.accounts.values()];
  }

  get(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  findStudent(grade: number, classNo: number, seat: number): Account | undefined {
    return this.all().find((a) => !a.bot && a.grade === grade && a.classNo === classNo && a.seat === seat);
  }

  nicknameTaken(nickname: string, exceptId?: string): boolean {
    const n = nickname.toLowerCase();
    return this.all().some((a) => a.id !== exceptId && a.nickname.toLowerCase() === n);
  }

  create(fields: Pick<Account, 'grade' | 'classNo' | 'seat' | 'name' | 'nickname'> & Partial<Account>, now: number): Account {
    const a: Account = {
      id: randomUUID(),
      points: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      games: 0,
      judged: 0,
      correct: 0,
      seenTopics: [],
      createdAt: now,
      lastSeen: now,
      ...fields,
    };
    this.accounts.set(a.id, a);
    this.changed();
    return a;
  }

  remove(id: string): boolean {
    const ok = this.accounts.delete(id);
    if (ok) this.changed();
    return ok;
  }

  /** 修改帳號後呼叫，稍後統一寫檔。 */
  changed() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const data: FileShape = { version: 1, accounts: this.all(), feedback: this.feedback };
    writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
    renameSync(tmp, this.file);
  }

  /** 排行榜：只有真人學生（電腦玩家不上榜），登入過就在榜上，依積分、勝場排序。 */
  leaderboard(me: Account, scope: 'all' | 'class'): LeaderboardView {
    const pool = this.all().filter(
      (a) => !a.bot && (scope === 'all' || (a.grade === me.grade && a.classNo === me.classNo)),
    );
    pool.sort((x, y) => y.points - x.points || y.wins - x.wins || x.games - y.games || x.createdAt - y.createdAt);
    const row = (a: Account, i: number): LeaderboardRow => ({
      rank: i + 1,
      nickname: a.nickname,
      points: a.points,
      wins: a.wins,
      games: a.games,
      me: a.id === me.id,
    });
    const rows = pool.slice(0, LEADERBOARD_SIZE).map(row);
    const myIndex = pool.findIndex((a) => a.id === me.id);
    return { scope, rows, mine: myIndex >= LEADERBOARD_SIZE ? row(me, myIndex) : null };
  }
}

export function profileOf(a: Account): ProfileView {
  return {
    nickname: a.nickname,
    grade: a.grade,
    classNo: a.classNo,
    seat: a.seat,
    name: a.name,
    points: a.points,
    wins: a.wins,
    losses: a.losses,
    draws: a.draws,
    games: a.games,
    accuracy: a.judged ? a.correct / a.judged : null,
    tutorialDone: Boolean(a.tutorialDone),
  };
}

// ───────────── 輸入檢查 ─────────────

const NAME_RE = /^[\p{Script=Han}A-Za-z·\s]{1,12}$/u;
const NICK_RE = /^[\p{Script=Han}\p{Script=Bopomofo}A-Za-z0-9_\-]{1,10}$/u;

/** 只檢查年級、班、座號；查詢上次姓名和登入都用它。 */
export function checkSeat(msg: unknown): { grade: number; classNo: number; seat: number } | string {
  const m = (msg ?? {}) as Record<string, unknown>;
  const grade = Number(m.grade);
  const classNo = Number(m.classNo);
  const seat = Number(m.seat);
  if (!Number.isInteger(grade) || grade < 1 || grade > 6) return '請選年級';
  if (!Number.isInteger(classNo) || classNo < 1 || classNo > 40) return '班級請填 1 到 40';
  if (!Number.isInteger(seat) || seat < 1 || seat > 60) return '座號請填 1 到 60';
  return { grade, classNo, seat };
}

/** 登入：帳號由年級、班、座號決定；姓名選填，每次登入以最新填的為準（可以留空）。 */
export function checkLogin(msg: unknown): { grade: number; classNo: number; seat: number; name: string } | string {
  const key = checkSeat(msg);
  if (typeof key === 'string') return key;
  const name = String((msg as Record<string, unknown>).name ?? '').trim().replace(/\s+/g, ' ');
  if (name && !NAME_RE.test(name)) return '姓名只能用中文或英文，最多 12 個字';
  return { ...key, name };
}

export function checkNickname(raw: unknown): string | { error: string } {
  const nickname = String(raw ?? '').trim();
  if (!NICK_RE.test(nickname)) return { error: '暱稱 1 到 10 個字，只能用中文、英文、數字' };
  return nickname;
}
