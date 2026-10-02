// 直接對決、回合結果、最終結算、事先調查的覆蓋畫面（企畫書 8、13.2、13.3 節）。
import { useState } from 'react';
import type { DuelResult, JudgementEntry, PlayerId, PlayerView, RoundResult } from '../../shared/types';
import { CARD_ICONS } from '../../shared/icons';
import { actions, CARD_NAME, useNet } from '../net';
import { CHOICE_LABEL, ROLE_LABEL } from '../labels';
import { AnswerBadge, ChoiceBadge, Modal, seconds, TimerRing, useTicker } from './common';
import { FactItem } from './Game';
import { Icon } from './Icon';
import { RankChangeView } from './Rank';
import { Coach } from './Tutorial';

const other = (p: PlayerId): PlayerId => (p === 'p1' ? 'p2' : 'p1');
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

// ───────────── 直接對決 ─────────────

function DuelLine({ label, result, pid }: { label: string; result: DuelResult; pid: PlayerId }) {
  const a = result.answers[pid];
  return (
    <p className="duel-line">
      <span>{label}</span>
      {a ? <ChoiceBadge choice={a.choice ? 'true' : 'false'} /> : <span className="muted">沒有作答</span>}
      <strong className={result.points[pid] ? 'c-true' : 'muted'}>{signed(result.points[pid])} 分</strong>
    </p>
  );
}

export function DuelOverlay({ view }: { view: PlayerView }) {
  useTicker(200);
  const d = view.duel!;
  return (
    <div className="duel-backdrop" role="dialog" aria-modal="true" aria-label="直接對決">
      <div className="duel-card">
        <p className="duel-title">
          <Icon name="zap" size={28} color="var(--duel)" /> 直接對決
        </p>
        <p className="muted">{d.initiatorIsMe ? '你發動' : '對手發動'}</p>
        {d.stage === 'ready' && <div className="duel-count">{seconds(view.deadline)}</div>}
        {d.stage === 'answer' && d.question && (
          <>
            <TimerRing deadline={view.deadline} total={10} size={72} color="var(--duel)" />
            <p className="statement big">「{d.question.statement}」</p>
            {d.myAnswer === null ? (
              <div className="row">
                <button className="judge c-true" onClick={() => actions.duelAnswer(true)}>
                  <Icon name="circle" size={26} strokeWidth={2.5} /> 是真的
                </button>
                <button className="judge c-false" onClick={() => actions.duelAnswer(false)}>
                  <Icon name="x" size={26} strokeWidth={2.5} /> 是假的
                </button>
              </div>
            ) : (
              <p>
                <ChoiceBadge choice={d.myAnswer ? 'true' : 'false'} />
              </p>
            )}
            {d.opponentAnswered && <p className="opp-color">對手已作答</p>}
          </>
        )}
        {d.stage === 'reveal' && d.result && (
          <>
            <p className="statement">「{d.result.question.statement}」</p>
            <p>
              <AnswerBadge answer={d.result.question.answer} />
            </p>
            <DuelLine label="你" result={d.result} pid={view.you} />
            <DuelLine label="對手" result={d.result} pid={other(view.you)} />
            <p className="explain">{d.result.question.explanation}</p>
            <p className="muted">{seconds(view.deadline)} 秒後繼續</p>
            <p className="muted small">{d.result.question.sources.map((s) => s.name).join('、')}</p>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── 回合結果 ─────────────

function scoreSteps(e: JudgementEntry): string[] {
  if (e.choice === 'hold') return ['暫不判斷 0'];
  const steps = [e.base > 0 ? '判斷正確 +1' : '判斷錯誤 -1'];
  if (e.doubled) steps.push('加倍 ×2');
  if (e.conservative && e.base * (e.doubled ? 2 : 1) < 0) steps.push('保守：不扣分');
  return steps;
}

function EntryColumn({ title, e, mine }: { title: string; e: JudgementEntry; mine: boolean }) {
  const m = e.message;
  return (
    <section className="result-col">
      <h3>{title}</h3>
      <p className="statement">「{m.statement}」</p>
      <p className="result-line">
        答案 <AnswerBadge answer={m.answer} /> ・ {mine ? '你' : '對手'}選了 <ChoiceBadge choice={e.choice} />
      </p>
      <p className={`delta ${e.final > 0 ? 'c-true' : e.final < 0 ? 'c-false' : ''}`}>
        {scoreSteps(e).length > 1 ? (
          <>
            {scoreSteps(e).join(' → ')} ＝ <strong>{signed(e.final)}</strong>
          </>
        ) : (
          scoreSteps(e)[0]
        )}
      </p>
      {mine && e.choice === 'hold' && <p className="praise">先不轉發，很聰明！</p>}
      {mine && e.choice !== 'hold' && (
        <p className="reward">
          {e.reward && e.reward !== 'hidden'
            ? `抽到「${CARD_NAME[e.reward]}」`
            : e.rewardNote === 'hand_full'
              ? '手牌已滿，沒有抽卡'
              : '牌庫已空'}
        </p>
      )}
      <p className="explain">{m.explanation}</p>
      <h4>{m.topic_title}</h4>
      <ol className="facts">
        {m.facts.map((f) => (
          <FactItem
            key={f.id}
            fact={f}
            strong={m.key_facts.includes(f.id)}
            note={m.key_facts.includes(f.id) ? '關鍵證據' : e.revealedBeforeResolve.includes(f.id) ? '先前查到' : undefined}
          />
        ))}
      </ol>
    </section>
  );
}

function RoundDetail({ r, you }: { r: RoundResult; you: PlayerId }) {
  const mine = r.entries.find((e) => e.judge === you)!;
  const theirs = r.entries.find((e) => e.judge !== you)!;
  const fnNames = (pid: PlayerId) => r.functionsUsed[pid].map((n) => CARD_NAME[n]).join('、') || '—';
  const anyFn = r.functionsUsed[you].length + r.functionsUsed[other(you)].length > 0;
  return (
    <>
      <div className="result-cols">
        <EntryColumn title="我判斷對手的消息" e={mine} mine />
        <EntryColumn title="對手判斷我的消息" e={theirs} mine={false} />
      </div>
      {anyFn && (
        <p className="muted">
          功能卡：你 {fnNames(you)}・對手 {fnNames(other(you))}
        </p>
      )}
      {r.duel && (
        <p className="muted">
          直接對決：你 {signed(r.duel.points[you])}・對手 {signed(r.duel.points[other(you)])}
        </p>
      )}
    </>
  );
}

export function RoundResultOverlay({ view }: { view: PlayerView }) {
  useTicker(500);
  const r = view.history.at(-1);
  if (!r) return null;
  return (
    <Modal label={`第 ${r.round} 回合結果`} wide>
      <h2>第 {r.round} 回合</h2>
      <RoundDetail r={r} you={view.you} />
      <div className="row end">
        {view.me.readyForNext ? (
          <span className="muted">等待對手…（{seconds(view.deadline)}）</span>
        ) : (
          <button className="btn primary" onClick={() => actions.nextRound()}>
            繼續（{seconds(view.deadline)}）
          </button>
        )}
      </div>
    </Modal>
  );
}

// ───────────── 最終結算 ─────────────

function reasonText(view: PlayerView): string {
  const g = view.gameOver!;
  const iWon = g.winner === view.you;
  switch (g.reason) {
    case 'score':
      return `${iWon ? '你' : '對手'}搶先達到 ${view.targetScore} 分`;
    case 'max_rounds':
      return `打滿 ${view.maxRounds} 回合，比較總分`;
    case 'forfeit':
      return iWon ? '對手離開了對局' : '你離開了對局';
    case 'disconnect':
      return iWon ? '對手斷線太久' : '你斷線太久';
    default:
      return '雙方都斷線，這局不算';
  }
}

export function FinalScreen({ view }: { view: PlayerView }) {
  const { rankChange } = useNet();
  const [open, setOpen] = useState<number | null>(null);
  const g = view.gameOver!;
  const iWon = g.winner === view.you;
  const title = view.tutorial
    ? '教學完成'
    : g.winner === 'draw'
      ? '平手！'
      : g.winner === 'void'
        ? '對局作廢'
        : iWon
          ? '你獲勝！'
          : '對手獲勝';
  return (
    <main className="final">
      {iWon && (
        <div className="confetti" aria-hidden>
          {Array.from({ length: 40 }, (_, i) => (
            <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 10) * 0.12}s` }} />
          ))}
        </div>
      )}
      <Coach view={view} />
      <div className="final-card">
        <Icon name="trophy" size={48} color={iWon ? 'var(--me)' : 'var(--ink-soft)'} />
        <h1>{title}</h1>
        <p className="muted">{view.tutorial ? '練習賽，不計牌位' : reasonText(view)}</p>
        <p className="final-score">
          <span className="me-color">你 {view.me.score}</span>
          <span> : </span>
          <span className="opp-color">
            {view.opponent.score} {view.opponent.nickname}
          </span>
        </p>
        {!view.tutorial && rankChange?.gameId === view.gameId && <RankChangeView change={rankChange} />}
        <div className="summary-scroll">
        <table className="summary">
          <thead>
            <tr>
              <th>回合</th>
              <th>我判斷的消息</th>
              <th>答案</th>
              <th>我的選擇</th>
              <th>得分</th>
            </tr>
          </thead>
          <tbody>
            {view.history.map((r) => {
              const e = r.entries.find((x) => x.judge === view.you)!;
              const duelPts = r.duel?.points[view.you] ?? 0;
              return [
                <tr key={r.round} className="clickable" onClick={() => setOpen(open === r.round ? null : r.round)}>
                  <td>{r.round}</td>
                  <td>
                    「{e.message.statement}」<span className="muted" aria-hidden>{open === r.round ? '▾' : '▸'}</span>
                  </td>
                  <td>
                    <AnswerBadge answer={e.message.answer} />
                  </td>
                  <td>{CHOICE_LABEL[e.choice]}</td>
                  <td>
                    {signed(e.final)}
                    {duelPts ? `（對決 ${signed(duelPts)}）` : ''}
                  </td>
                </tr>,
                open === r.round && (
                  <tr key={`${r.round}-d`}>
                    <td colSpan={5}>
                      <RoundDetail r={r} you={view.you} />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
        </div>
        <div className="row">
          <button className="btn" onClick={actions.backHome}>
            回首頁
          </button>
          <button className="btn primary" onClick={actions.joinQueue}>
            再來一局
          </button>
        </div>
      </div>
    </main>
  );
}

// ───────────── 事先調查 ─────────────

export function InvestigateModal({ count }: { count: number }) {
  return (
    <Modal label="事先調查">
      <h3>
        <Icon name="eye" color="var(--function)" /> 事先調查
      </h3>
      <p className="muted">翻一張對手手牌：是消息卡就得到查證卡</p>
      <div className="backs">
        {Array.from({ length: count }, (_, i) => (
          <button key={i} className="card-back" aria-label={`第 ${i + 1} 張牌`} onClick={() => actions.pick(i)}>
            <Icon name="message-square-text" size={28} color="var(--ink-soft)" />
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function PeekModal() {
  const { peek } = useNet();
  if (!peek) return null;
  return (
    <Modal label="翻牌結果">
      {peek.card.kind === 'message' ? (
        <p className="statement">「{peek.card.statement}」</p>
      ) : (
        <p className="statement">
          <Icon name={CARD_ICONS[peek.card.name]} /> {CARD_NAME[peek.card.name]}
        </p>
      )}
      <p className={peek.gotVerify ? 'c-true' : 'muted'}>
        {peek.gotVerify
          ? '+1 查證卡'
          : peek.card.kind === 'message'
            ? peek.handFull
              ? '手牌已滿，沒有抽卡'
              : '牌庫沒有查證卡了'
            : '不是消息卡'}
      </p>
      <div className="row end">
        <button className="btn primary" onClick={actions.closePeek}>
          知道了
        </button>
      </div>
    </Modal>
  );
}
