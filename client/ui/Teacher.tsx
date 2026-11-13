// 老師頁（企畫書 18.5）：只能在執行伺服器的那台電腦上開啟。
// 排行榜樣式（前三名大卡片＋往下的名次清單），每個人都清楚標出第幾名、暱稱、姓名、班級座號、在線或離線；
// 離線的學生一樣留在榜上。可改暱稱、刪除帳號、暫停比賽、開始新的一節課、重設排行榜。
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
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
  lessonWins: number;
  lessonGames: number;
  lessonPoints: number;
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
  lessonStartedAt: number;
  paused: boolean;
  accounts: Row[];
  feedback: FeedbackRow[];
}

type SortKey = 'record' | 'lesson' | 'seat';

const MEDAL = ['#FFD60A', '#C8D6CE', '#FF9F43'];

async function post(path: string, body?: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) alert(data.error ?? '操作失敗');
}

const whoOf = (a: Row) => (a.bot ? '電腦玩家' : `${a.grade} 年 ${a.classNo} 班 ${a.seat} 號`);

export function Teacher() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBots, setShowBots] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('record');
  const [classFilter, setClassFilter] = useState('all');
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

  const bySeat = (x: Row, y: Row) => x.grade - y.grade || x.classNo - y.classNo || x.seat - y.seat;
  // 戰績排序和學生看到的排行榜同一套規則：積分高、勝場多、場數少的在前
  const byRecord = (x: Row, y: Row) => y.points - x.points || y.wins - x.wins || x.games - y.games || bySeat(x, y);
  // 本節排序：這一節課勝場多、積分增加多的在前，平手再看累積戰績
  const byLesson = (x: Row, y: Row) => y.lessonWins - x.lessonWins || y.lessonPoints - x.lessonPoints || x.lessonGames - y.lessonGames || byRecord(x, y);
  const classKey = (a: Row) => `${a.grade}-${a.classNo}`;
  const classes = [...new Set(data.accounts.filter((a) => !a.bot).map(classKey))].sort((p, q) => {
    const [pg, pc] = p.split('-').map(Number);
    const [qg, qc] = q.split('-').map(Number);
    return pg - qg || pc - qc;
  });
  const sorter = sortBy === 'record' ? byRecord : sortBy === 'lesson' ? byLesson : bySeat;
  const students = data.accounts
    .filter((a) => (showBots && classFilter === 'all') || !a.bot)
    .filter((a) => classFilter === 'all' || classKey(a) === classFilter)
    .sort((x, y) => Number(x.bot) - Number(y.bot) || sorter(x, y));
  const lessonSince = new Date(data.lessonStartedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  const ranked = sortBy !== 'seat';
  // 名次只算真人學生；電腦玩家排在最後、不編名次
  const real = students.filter((a) => !a.bot);
  const top = ranked ? real.slice(0, 3) : [];
  const topIds = new Set(top.map((a) => a.id));
  const rest = students.filter((a) => !topIds.has(a.id));
  const rankOf = (a: Row) => real.indexOf(a) + 1;

  const editNick = async (a: Row) => {
    const nickname = prompt(`把「${a.nickname}」改成：`, a.nickname);
    if (nickname && nickname !== a.nickname) {
      await post(`/api/teacher/accounts/${a.id}/nickname`, { nickname });
      load();
    }
  };
  const removeAcc = async (a: Row) => {
    if (confirm(`刪除 ${a.grade} 年 ${a.classNo} 班 ${a.seat} 號 ${a.name} 的帳號？積分與戰績會一起刪除，不能復原。`)) {
      await post(`/api/teacher/accounts/${a.id}/delete`);
      load();
    }
  };
  const togglePause = async () => {
    if (data.paused) {
      await post('/api/teacher/pause', { paused: false });
    } else if (confirm(`暫停比賽？\n目前 ${data.playing} 局對戰會立刻結束，雙方都不計輸贏；排隊中的學生會被請出配對，直到你按「恢復比賽」。`)) {
      await post('/api/teacher/pause', { paused: true });
    }
    load();
  };

  const status = (a: Row) =>
    a.bot ? null : a.online ? (
      <span className="t-status on">
        <i className="online-dot" /> 線上
      </span>
    ) : (
      <span className="t-status off">離線</span>
    );

  const actionsOf = (a: Row) => (
    <div className="teacher-actions">
      <button className="btn small" onClick={() => editNick(a)}>
        <Icon name="pencil" size={14} /> 暱稱
      </button>
      {!a.bot && (
        <button className="btn small ghost" onClick={() => removeAcc(a)}>
          <Icon name="x" size={14} /> 刪除
        </button>
      )}
    </div>
  );

  const TopCard = ({ a, place }: { a: Row; place: number }) => {
    const medal = MEDAL[place - 1];
    const lessonMain = sortBy === 'lesson';
    return (
      <div className={`lb-top t-top p${place}${a.online ? '' : ' offline'}`} style={{ '--medal': medal } as CSSProperties}>
        <Icon name="trophy" size={place === 1 ? 52 : 38} color={medal} />
        <div className="lb-top-main">
          <span className="lb-top-rank">第 {place} 名</span>
          <span className="lb-top-nick">{a.nickname}</span>
          <span className="t-who">
            <b>{a.name || '（沒填姓名）'}</b>・{whoOf(a)} {status(a)}
          </span>
          <TierBadge points={a.points} />
          <span className="t-sub">
            勝／敗／和 {a.wins}／{a.losses}／{a.draws}・判斷正確 {a.accuracy === null ? '—' : `${Math.round(a.accuracy * 100)}%`}
          </span>
          {actionsOf(a)}
        </div>
        <div className="lb-top-score">
          <b>{lessonMain ? a.lessonWins : a.points}</b>
          <span>{lessonMain ? '本節勝場' : '分'}</span>
          <small>{lessonMain ? `累積 ${a.points} 分` : `本節 ${a.lessonWins} 勝`}</small>
        </div>
      </div>
    );
  };

  const ListRow = ({ a }: { a: Row }) => (
    <li className={`t-row${a.online || a.bot ? '' : ' offline'}${a.bot ? ' bot-row' : ''}`}>
      <span className="t-rank" title={a.bot ? '電腦玩家不編名次' : undefined}>
        {ranked && !a.bot ? (
          <>
            <b>{rankOf(a)}</b>
            <small>名</small>
          </>
        ) : (
          ''
        )}
      </span>
      <span className="t-id">
        <b>
          {a.nickname} {a.bot && <em className="tag fn">電腦</em>}
        </b>
        <small>
          {a.bot ? '電腦玩家' : `${a.name || '（沒填姓名）'}・${whoOf(a)}`} {status(a)}
        </small>
      </span>
      <TierBadge points={a.points} />
      <span className="t-stat">
        <b>{a.points}</b>
        <small>積分</small>
      </span>
      <span className="t-stat" title={`本節 ${a.lessonGames} 場，積分 ${a.lessonPoints >= 0 ? '+' : ''}${a.lessonPoints}`}>
        <b>{a.bot ? '—' : a.lessonWins}</b>
        <small>本節勝場</small>
      </span>
      <span className="t-stat">
        <b>
          {a.wins}／{a.losses}／{a.draws}
        </b>
        <small>勝／敗／和</small>
      </span>
      <span className="t-stat">
        <b>{a.accuracy === null ? '—' : `${Math.round(a.accuracy * 100)}%`}</b>
        <small>判斷正確</small>
      </span>
      {actionsOf(a)}
    </li>
  );

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
        <div className="t-pause">
          <button className={'btn big' + (data.paused ? ' primary' : ' danger')} onClick={togglePause}>
            {data.paused ? '▶ 恢復比賽' : '⏸ 暫停比賽（結束所有對局，不計輸贏）'}
          </button>
          {data.paused && <span className="notice warn">目前暫停中：進行中的對局已作廢，學生不能開始新的對局。</span>}
        </div>
      </header>

      <div className="teacher-bulk">
        <label className="teacher-toggle">
          班級{' '}
          <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
            <option value="all">全部</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c.split('-')[0]} 年 {c.split('-')[1]} 班
              </option>
            ))}
          </select>
        </label>
        <label className="teacher-toggle">
          排序{' '}
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
            <option value="record">依戰績（積分、勝場）</option>
            <option value="lesson">依本節勝場</option>
            <option value="seat">依班級座號</option>
          </select>
        </label>
        <label className="teacher-toggle">
          <input type="checkbox" checked={showBots} onChange={(e) => setShowBots(e.target.checked)} /> 顯示電腦玩家（學生看不到這個標記）
        </label>
      </div>
      <div className="teacher-bulk">
        <button
          className="btn small"
          title="只把「本節勝場」歸零，累積的積分和戰績不動"
          onClick={async () => {
            if (confirm('開始新的一節課？\n「本節勝場」會歸零，累積的積分和戰績不受影響。')) {
              await post('/api/teacher/lesson/new');
              load();
            }
          }}
        >
          開始新的一節課
        </button>
        <span className="muted">本節從 {lessonSince} 開始計算</span>
        <button
          className="btn small"
          onClick={async () => {
            if (confirm('把全部學生的積分、勝敗、判斷紀錄歸零？\n帳號和暱稱會保留，歸零後不能復原。')) {
              await post('/api/teacher/reset-scores', { confirm: true });
              load();
            }
          }}
        >
          重設排行榜（積分與戰績歸零）
        </button>
        <button
          className="btn small ghost"
          onClick={async () => {
            const n = data.accounts.filter((a) => !a.bot).length;
            if (n === 0) return alert('目前沒有學生帳號');
            if (prompt(`這會刪除全部 ${n} 個學生帳號，包含積分與戰績，不能復原。\n確定的話，請輸入「刪除」兩個字：`) === '刪除') {
              await post('/api/teacher/students/delete-all', { confirm: true });
              load();
            }
          }}
        >
          刪除全部學生帳號
        </button>
      </div>

      {ranked && top.length > 0 && (
        <div className="lb-podium t-podium">
          {top.map((a, i) => (
            <TopCard key={a.id} a={a} place={i + 1} />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <ol className="t-list" aria-label={ranked ? '第 4 名以後' : '全部學生'}>
          {rest.map((a) => (
            <ListRow key={a.id} a={a} />
          ))}
        </ol>
      )}
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
