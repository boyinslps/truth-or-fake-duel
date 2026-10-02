// 牌位徽章、升級進度、積分變化與排行榜（企畫書第 18 節）。
import type { CSSProperties } from 'react';
import type { RankChange } from '../../shared/types';
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

export function Leaderboard() {
  const { leaderboard, profile } = useNet();
  const scope = leaderboard?.scope ?? 'all';
  const rows = leaderboard ? [...leaderboard.rows, ...(leaderboard.mine ? [leaderboard.mine] : [])] : [];
  // 超過 10 人就分左右兩欄，一頁看完不用捲動
  const split = rows.length > 10;
  const cols = split ? [rows.slice(0, Math.ceil(rows.length / 2)), rows.slice(Math.ceil(rows.length / 2))] : [rows];
  return (
    <main className="lobby">
      <div className={'lobby-card board-card' + (split ? ' wide' : '')}>
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
        ) : rows.length === 0 ? (
          <p className="muted">還沒有人上榜</p>
        ) : (
          <div className={'lb-cols' + (split ? ' two' : '')}>
            {cols.map((part, ci) => (
              <table key={ci} className="summary lb-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>暱稱</th>
                    <th>牌位</th>
                    <th>積分</th>
                    <th>勝場</th>
                  </tr>
                </thead>
                <tbody>
                  {part.map((r) => (
                    <tr key={r.rank + '-' + r.nickname} className={r.me ? 'me-row' : ''}>
                      <td className="lb-rank">
                        {r.rank <= 3 ? <Icon name="trophy" size={16} color={['#FFD60A', '#C8D6CE', '#FF9F43'][r.rank - 1]} /> : r.rank}
                      </td>
                      <td>{r.nickname}</td>
                      <td>
                        <TierBadge points={r.points} />
                      </td>
                      <td className="num">{r.points}</td>
                      <td className="num">{r.wins}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
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
