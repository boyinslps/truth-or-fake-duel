// 登入、首頁、配對中、配對成功（企畫書 10.2、第 13、18 節）。
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { actions, useNet } from '../net';
import { Icon } from './Icon';
import { seconds, useTicker } from './common';
import { TierBadge, TierProgress } from './Rank';

function Logo() {
  return (
    <>
      <div className="logo" aria-hidden>
        <Icon name="circle" size={44} color="var(--true)" strokeWidth={2.5} />
        <Icon name="x" size={44} color="var(--false)" strokeWidth={2.5} />
      </div>
      <h1>真假對決</h1>
    </>
  );
}

const GRADES = ['一', '二', '三', '四', '五', '六'];

export function Login() {
  const { connected, loginError, nameHint } = useNet();
  const [grade, setGrade] = useState('');
  const [classNo, setClassNo] = useState('');
  const [seat, setSeat] = useState('');
  const [name, setName] = useState('');
  const key = `${grade}-${classNo}-${seat}`;
  const complete = Number(grade) >= 1 && Number(classNo) >= 1 && Number(seat) >= 1;
  // 使用者自己打過姓名的那組座號，就不再用上次的姓名蓋掉
  const typedFor = useRef('');

  // 年級、班、座號填好後，問伺服器上次登記的姓名並帶入
  useEffect(() => {
    if (!complete) return;
    const t = setTimeout(() => actions.lookupName({ grade: Number(grade), classNo: Number(classNo), seat: Number(seat) }), 250);
    return () => clearTimeout(t);
  }, [complete, grade, classNo, seat]);
  useEffect(() => {
    if (nameHint && nameHint.key === key && typedFor.current !== key) setName(nameHint.name);
  }, [nameHint, key]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    actions.login({ grade: Number(grade), classNo: Number(classNo), seat: Number(seat), name: name.trim() });
  };
  return (
    <main className="lobby">
      <form className="lobby-card login-card" onSubmit={submit}>
        <Logo />
        <div className="login-grid">
          <label>
            <span>年級</span>
            <select value={grade} onChange={(e) => setGrade(e.target.value)} required>
              <option value="" disabled>
                選擇
              </option>
              {GRADES.map((g, i) => (
                <option key={g} value={i + 1}>
                  {g}年級
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>班</span>
            <input inputMode="numeric" pattern="[0-9]*" maxLength={2} value={classNo} onChange={(e) => setClassNo(e.target.value)} required />
          </label>
          <label>
            <span>座號</span>
            <input inputMode="numeric" pattern="[0-9]*" maxLength={2} value={seat} onChange={(e) => setSeat(e.target.value)} required />
          </label>
          <label className="wide">
            <span>姓名（可不填）</span>
            <input
              value={name}
              maxLength={12}
              autoComplete="off"
              onChange={(e) => {
                typedFor.current = key;
                setName(e.target.value);
              }}
            />
          </label>
        </div>
        {loginError && <p className="notice warn">{loginError}</p>}
        <button className="btn primary big" disabled={!connected}>
          登入
        </button>
        {!connected && <p className="notice">正在連線到伺服器…</p>}
      </form>
    </main>
  );
}

function NicknameEditor({ nickname }: { nickname: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(nickname);
  if (!editing) {
    return (
      <p className="nickname-line">
        <strong>{nickname}</strong>
        <button
          type="button"
          className="icon-btn"
          aria-label="改暱稱"
          onClick={() => {
            setValue(nickname);
            setEditing(true);
          }}
        >
          <Icon name="pencil" size={16} />
        </button>
      </p>
    );
  }
  return (
    <form
      className="nickname-edit"
      onSubmit={(e) => {
        e.preventDefault();
        actions.setNickname(value.trim());
        setEditing(false);
      }}
    >
      <input autoFocus value={value} maxLength={10} onChange={(e) => setValue(e.target.value)} aria-label="暱稱" />
      <button className="btn small primary">好</button>
      <button type="button" className="btn small ghost" onClick={() => setEditing(false)}>
        取消
      </button>
    </form>
  );
}

export function Home() {
  const { profile, cancelled, nicknameError } = useNet();
  if (!profile) return null;
  const acc = profile.accuracy === null ? null : Math.round(profile.accuracy * 100);
  return (
    <main className="lobby">
      <div className="lobby-card">
        <Logo />
        <section className="profile-card">
          <NicknameEditor nickname={profile.nickname} />
          {nicknameError && <p className="notice warn">{nicknameError}</p>}
          <p className="muted small-line">
            {profile.grade} 年 {profile.classNo} 班 {profile.seat} 號 {profile.name}
          </p>
          <TierBadge points={profile.points} big />
          <TierProgress points={profile.points} />
          {profile.games > 0 && (
            <p className="muted small-line">
              {profile.wins} 勝 {profile.losses} 敗{profile.draws ? ` ${profile.draws} 和` : ''}
              {acc !== null && `・判斷正確 ${acc}%`}
            </p>
          )}
        </section>
        <ul className="rules">
          <li>
            <Icon name="message-square-text" color="var(--me)" /> 雙方各出一則消息，只有出牌的人知道真假。
          </li>
          <li>
            <Icon name="search" color="var(--verify)" /> 用查證卡找證據，再選「是真的」「是假的」或「暫不判斷」。
          </li>
          <li>
            <Icon name="trophy" color="var(--function)" /> 先搶到 7 分的人獲勝，最多 12 回合。
          </li>
        </ul>
        {cancelled && <p className="notice warn">{cancelled}</p>}
        <button className="btn primary big" onClick={actions.joinQueue}>
          開始對戰
        </button>
        <div className="row">
          <button className="btn" onClick={() => actions.openLeaderboard('all')}>
            <Icon name="list-ordered" size={16} /> 排行榜
          </button>
          <button className="btn" onClick={actions.startTutorial}>
            教學
          </button>
          <button className="btn" onClick={actions.openFeedback}>
            回饋
          </button>
          <button className="btn ghost" onClick={actions.logout}>
            <Icon name="log-out" size={16} /> 登出
          </button>
        </div>
      </div>
    </main>
  );
}

export function Matching() {
  const { matching, cancelled } = useNet();
  useTicker(500);
  const waited = matching ? Math.floor((Date.now() - matching.since) / 1000) : 0;
  return (
    <main className="lobby">
      <div className="lobby-card">
        <div className="spinner" aria-hidden />
        <h2>正在尋找對手……</h2>
        <p className="match-timer" role="timer" aria-label={`已搜尋 ${waited} 秒`}>{waited}<small> 秒</small></p>
        {cancelled && <p className="notice warn">{cancelled}</p>}
        <button className="btn" onClick={actions.leaveQueue}>
          取消
        </button>
      </div>
    </main>
  );
}

export function MatchFound() {
  const { match } = useNet();
  useTicker();
  if (!match) return null;
  return (
    <main className="lobby">
      <div className="lobby-card">
        <h2>對手已找到！</h2>
        <p className="versus">
          <span className="me-color">你</span> vs <span className="opp-color">{match.opponentNickname}</span>
        </p>
        {match.ready ? (
          <p className="tagline">等待對手準備…</p>
        ) : (
          <button className="btn primary big" onClick={actions.ready}>
            準備（{seconds(match.deadline)}）
          </button>
        )}
      </div>
    </main>
  );
}
