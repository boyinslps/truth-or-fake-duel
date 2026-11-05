// 牌位徽章、升級進度、積分變化與排行榜（企畫書第 18 節）。
import type { CSSProperties } from 'react';
import type { LeaderboardRow, RankChange } from '../../shared/types';
import { nextTier, tierOf } from '../../shared/rank';
import { actions, useNet } from '../net';
import { Icon } from './Icon';

export function TierBadge({ points, big }: { points: number; big?: boolean }) {
  const t = tierOf(points);
  return (
    <span className={`tier-badge${big ? ' big' : ''}`} style={{ '--tier': t.color } as CSSProperties}>
      <Icon name={t.icon} size={big ? 22 : 15} color={t.color} strokeWidth={2.2} />
      {t.name}
    </span>
  );
}

export function TierProgress({ points }: { points: number }) {
  const t = tierOf(points);
  const next = nextTier(t);
  const pct = next ? ((points - t.min) / (next.min - t.min)) * 100 : 100;
  return (
    <div className="tier-progress">
      <div className="tp-bar" aria-hidden>
        <i style={{ width: `${pct}%`, background: t.color }} />
      </div>
      <span className="tp-text">
        <b>{points}</b> 分{next && <span className="muted">／{next.min}</span>}
      </span>
    </div>
  );
}

/** 最終結算畫面：這局的積分變化，升級時特別標示。 */
export function RankChangeView({ change }: { change: RankChange }) {
  const delta = change.after - change.before;
  const up = tierOf(change.after).index > tierOf(change.before).index;
  return (
    <div className={`rank-change${up ? ' up' : ''}`}>
      <span className={`rc-delta ${delta > 0 ? 'c-true' : delta < 0 ? 'c-false' : 'muted'}`}>
        {delta > 0 ? `+${delta}` : delta}
      </span>
      <TierBadge points={change.after} big={up} />
      {up && <span className="rc-up">升級！</span>}
      <TierProgress points={change.after} />
    </div>
  );
}

const MEDAL = ['#FFD60A', '#C8D6CE', '#FF9F43'];

/** 前三名：特別大的卡片，第一名最大。 */
function TopCard({ r }: { r: LeaderboardRow }) {
  const medal = MEDAL[r.rank - 1];
  return (
    <div className={`lb-top p${r.rank}${r.me ? ' me' : ''}`} style={{ '--medal': medal } as CSSProperties}>
      <Icon name="trophy" size={r.rank === 1 ? 52 : 38} color={medal} />
      <div className="lb-top-main">
        <span className="lb-top-rank">第 {r.rank} 名</span>
        <span className="lb-top-nick">{r.nickname}</span>
        {r.who && <span className="lb-who">{r.who}</span>}
        <TierBadge points={r.points} />
      </div>
      <div className="lb-top-score">
        <b>{r.points}</b>
        <span>分</span>
        <small>{r.wins} 勝</small>
      </div>
    </div>
  );
}

function ListRow({ r }: { r: LeaderboardRow }) {
  return (
    <li className={'lb-row' + (r.me ? ' me' : '')}>
      <span className="lb-rank">{r.rank}</span>
      <span className="lb-name">
        <b>{r.nickname}</b>
        {r.who && <small className="lb-who">{r.who}</small>}
      </span>
      <TierBadge points={r.points} />
      <span className="lb-pts">{r.points}</span>
    </li>
  );
}

export function Leaderboard() {
  const { leaderboard, profile } = useNet();
  const scope = leaderboard?.scope ?? 'all';
  const top = leaderboard ? leaderboard.rows.slice(0, 3) : [];
  const rest = leaderboard ? leaderboard.rows.slice(3) : [];
  const mine = leaderboard?.mine ?? null;
  return (
    <main className="lobby">
      <div className="lobby-card board-card">
        <div className="lb-head">
          <h2>
            <Icon name="trophy" color="var(--verify)" /> 排行榜
          </h2>
          <div className="lb-tabs" role="tablist">
            {(['all', 'class'] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={scope === s}
                className={'btn small' + (scope === s ? ' primary' : '')}
                onClick={() => actions.openLeaderboard(s)}
              >
                {s === 'all' ? '全部' : profile ? profile.grade + ' 年 ' + profile.classNo + ' 班' : '我的班'}
              </button>
            ))}
          </div>
        </div>
        {!leaderboard ? (
          <p className="muted">載入中…</p>
        ) : leaderboard.rows.length === 0 ? (
          <p className="muted">還沒有人上榜</p>
        ) : (
          <>
            <div className="lb-podium">
              {top.map((r) => (
                <TopCard key={r.rank} r={r} />
              ))}
            </div>
            {rest.length > 0 && (
              <ol className="lb-list" aria-label="第 4 名以後">
                {rest.map((r) => (
                  <ListRow key={r.rank} r={r} />
                ))}
              </ol>
            )}
            {mine && (
              <div className="lb-mine">
                <span className="muted">你的名次</span>
                <ol className="lb-list pinned">
                  <ListRow r={mine} />
                </ol>
              </div>
            )}
          </>
        )}
        <div className="row">
          <button className="btn" onClick={actions.closeLeaderboard}>
            返回
          </button>
        </div>
      </div>
    </main>
  );
}
