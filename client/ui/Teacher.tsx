// 老師頁（企畫書 18.5）：只能在執行伺服器的那台電腦上開啟。
// 顯示學生要連的網址、線上人數、全部帳號（含真實姓名與電腦玩家標記），可改暱稱、刪除帳號。
import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';
import { TierBadge } from './Rank';

interface Row {
  id: string;
  bot: boolean;
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
  accuracy: number | null;
  online: boolean;
}

interface FeedbackRow {
  id: string;
  at: number;
  grade: number;
  classNo: number;
  seat: number;
  name: string;
  nickname: string;
  text: string;
}

interface Overview {
  urls: string[];
  online: number;
  playing: number;
  accounts: Row[];
  feedback: FeedbackRow[];
}

async function post(path: string, body?: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) alert(data.error ?? '操作失敗');
}

export function Teacher() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBots, setShowBots] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/teacher/overview');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : '連不到伺服器');
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  if (error) {
    return (
      <main className="lobby">
        <div className="lobby-card">
          <h2>老師頁</h2>
          <p className="notice warn">{error}</p>
        </div>
      </main>
    );
  }
  if (!data) return null;

  const students = data.accounts
    .filter((a) => showBots || !a.bot)
    .sort((x, y) => Number(x.bot) - Number(y.bot) || x.grade - y.grade || x.classNo - y.classNo || x.seat - y.seat);

  return (
    <main className="teacher">
      <header className="teacher-head">
        <h1>真假對決・老師頁</h1>
        <div className="teacher-urls">
          <span className="muted">學生在瀏覽器輸入</span>
          {data.urls.length ? data.urls.map((u) => <strong key={u}>{u}</strong>) : <strong>找不到區域網路位址</strong>}
        </div>
        <p className="muted">
          線上 {data.online} 人・對戰中 {data.playing} 局・帳號 {data.accounts.filter((a) => !a.bot).length} 個
        </p>
      </header>
      <label className="teacher-toggle">
        <input type="checkbox" checked={showBots} onChange={(e) => setShowBots(e.target.checked)} /> 顯示電腦玩家（學生看不到這個標記）
      </label>
      <table className="summary teacher-table">
        <thead>
          <tr>
            <th>班級</th>
            <th>座號</th>
            <th>姓名</th>
            <th>暱稱</th>
            <th>牌位</th>
            <th>積分</th>
            <th>勝／敗／和</th>
            <th>判斷正確</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {students.map((a) => (
            <tr key={a.id} className={a.bot ? 'bot-row' : ''}>
              <td>{a.bot ? <em className="tag fn">電腦</em> : `${a.grade} 年 ${a.classNo} 班`}</td>
              <td className="num">{a.bot ? '' : a.seat}</td>
              <td>
                {a.name || '—'}
                {a.online && <span className="online-dot" title="線上" />}
              </td>
              <td>{a.nickname}</td>
              <td>
                <TierBadge points={a.points} />
              </td>
              <td className="num">{a.points}</td>
              <td className="num">
                {a.wins}／{a.losses}／{a.draws}
              </td>
              <td className="num">{a.accuracy === null ? '—' : `${Math.round(a.accuracy * 100)}%`}</td>
              <td className="teacher-actions">
                <button
                  className="btn small"
                  onClick={async () => {
                    const nickname = prompt(`把「${a.nickname}」改成：`, a.nickname);
                    if (nickname && nickname !== a.nickname) {
                      await post(`/api/teacher/accounts/${a.id}/nickname`, { nickname });
                      load();
                    }
                  }}
                >
                  <Icon name="pencil" size={14} /> 暱稱
                </button>
                {!a.bot && (
                  <button
                    className="btn small ghost"
                    onClick={async () => {
                      if (confirm(`刪除 ${a.grade} 年 ${a.classNo} 班 ${a.seat} 號 ${a.name} 的帳號？積分與戰績會一起刪除，不能復原。`)) {
                        await post(`/api/teacher/accounts/${a.id}/delete`);
                        load();
                      }
                    }}
                  >
                    <Icon name="x" size={14} /> 刪除
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {students.length === 0 && <p className="muted">還沒有學生登入過</p>}
      <h2 className="teacher-h2">學生回饋（{data.feedback.length}）</h2>
      {data.feedback.length === 0 ? (
        <p className="muted">還沒有人寫回饋</p>
      ) : (
        <ul className="feedback-list">
          {data.feedback.map((f) => (
            <li key={f.id} className="feedback-item">
              <div className="feedback-meta">
                <span>{new Date(f.at).toLocaleString('zh-TW', { hour12: false })}</span>
                <strong>
                  {f.grade} 年 {f.classNo} 班 {f.seat} 號 {f.name || f.nickname}
                </strong>
                <span className="muted">（{f.nickname}）</span>
                <button
                  className="btn small ghost"
                  onClick={async () => {
                    if (confirm('刪除這則回饋？')) {
                      await post('/api/teacher/feedback/' + f.id + '/delete');
                      load();
                    }
                  }}
                >
                  刪除
                </button>
              </div>
              <p className="feedback-body">{f.text}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
