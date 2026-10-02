// 對局主畫面（企畫書 13.1）：上方狀態列、three.js 桌面、共同資訊區、行動列。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Choice, Fact, FunctionName, PlayerView, UtilityCard } from '../../shared/types';
import { CARD_ICONS, CATEGORY_ICONS, CHOICE_ICONS, ROLE_ICONS } from '../../shared/icons';
import { actions, CARD_NAME, useNet } from '../net';
import { CARD_EFFECT, CHOICE_LABEL, FUNCTION_ORDER, PHASE_LABEL, ROLE_LABEL } from '../labels';
import { hasWebGL, Scene } from '../scene/Scene';
import { AnswerBadge, Dots, Modal, TimerRing } from './common';
import { Icon } from './Icon';
import { DuelOverlay, FinalScreen, InvestigateModal, PeekModal, RoundResultOverlay } from './Overlays';
import { Coach } from './Tutorial';
import { useHover } from './hover';
import { burstAt } from '../fx/pixels';

/** 分數變動時，在分數旁炸出像素。 */
function useScoreBurst(score: number, color: string) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(score);
  useEffect(() => {
    if (score !== prev.current) {
      const up = score > prev.current;
      burstAt(ref.current, up ? [color, '#FFFFFF', color] : ['#7C9A88', '#FF3355'], up ? 34 : 18, up ? 1 : 0.6);
      prev.current = score;
    }
  }, [score, color]);
  return ref;
}

/** 手牌的說明框：卡面保持乾淨，指到才顯示詳情。 */
function HoverTip() {
  const h = useHover();
  if (!h) return null;
  // 說明框固定在手牌上方，不擋住放大的卡片
  const style = { left: Math.min(Math.max(h.x, 160), window.innerWidth - 540), top: window.innerHeight * 0.5 };
  if (h.kind === 'message') {
    const m = h.message;
    return (
      <div className="card-tip" style={style} role="tooltip">
        <span className="msg-head">
          <span>
            <Icon name={CATEGORY_ICONS[m.category]} size={14} /> {m.topicTitle}
          </span>
          <Dots n={m.difficulty} color="var(--me)" />
        </span>
        <strong className="tip-statement">「{m.statement}」</strong>
        {m.answer !== undefined && (
          <span className="tip-row">
            <AnswerBadge answer={m.answer} />
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="card-tip" style={style} role="tooltip">
      <strong>
        <Icon name={CARD_ICONS[h.name]} size={16} /> {CARD_NAME[h.name]}
      </strong>
      <span>{CARD_EFFECT[h.name]}</span>
      {!h.status.usable && <span className="tip-no">{h.status.reason}</span>}
    </div>
  );
}

const PHASE_TOTAL = (v: PlayerView) => {
  switch (v.phase) {
    case 'select_message':
      return 15;
    case 'reveal':
      return 3;
    case 'action':
      return 45;
    case 'round_result':
      return 20;
    default:
      return 10;
  }
};

/** 離開按鈕：按下後先確認，離開等於投降。 */
function LeaveButton() {
  const [confirmLeave, setConfirmLeave] = useState(false);
  return (
    <>
      <button className="btn ghost small" onClick={() => setConfirmLeave(true)}>
        離開
      </button>
      {confirmLeave && (
        <Modal label="確認離開">
          <h3>確定要離開嗎？</h3>
          <p>離開等於投降，對手會獲勝。</p>
          <div className="row">
            <button className="btn" onClick={() => setConfirmLeave(false)}>
              繼續玩
            </button>
            <button className="btn danger" onClick={() => actions.leaveGame()}>
              離開對局
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** 現在的階段：兩個字，放在主畫面左上，和倒數放在一起。 */
function phaseHint(v: PlayerView): string {
  switch (v.phase) {
    case 'select_message':
      return v.me.selected ? '等待' : '出牌';
    case 'reveal':
      return '翻牌';
    case 'action':
      return v.me.locked ? '等待' : '判斷';
    case 'duel':
      return '對決';
    case 'round_result':
      return '結算';
    default:
      return '結束';
  }
}

/** 教學、回饋、離開：三個小按鈕。 */
function HudButtons() {
  return (
    <div className="hud-btns">
      <button className="btn ghost small" onClick={actions.openHelp}>
        教學
      </button>
      <button className="btn ghost small" onClick={actions.openFeedback}>
        回饋
      </button>
      <LeaveButton />
    </div>
  );
}

/** 主畫面左上：回合與階段（兩個字）。倒數在桌面分隔線旁，比分在各自的半場。 */
function Hud({ view }: { view: PlayerView }) {
  return (
    <div className="hud" role="status">
      <span className="hud-round">
        回合 {view.round}
        <i>/{view.maxRounds}</i>
      </span>
      <div className="hud-phase">{phaseHint(view)}</div>
      <HudButtons />
      {/* 倒數畫在桌面上；這裡留給螢幕閱讀器 */}
      <div className="a11y-only">
        <TimerRing deadline={view.phase === 'duel' ? null : view.deadline} total={PHASE_TOTAL(view)} size={44} />
      </div>
      {!view.opponent.connected && <div className="hud-offline">對手斷線</div>}
    </div>
  );
}

function TopBar({ view }: { view: PlayerView }) {
  const myRef = useScoreBurst(view.me.score, '#00FF66');
  const oppRef = useScoreBurst(view.opponent.score, '#2DE2E6');
  const pips = (score: number, cls: string) => (
    <span className="pips" aria-hidden>
      {Array.from({ length: view.targetScore }, (_, i) => (
        <i key={i} className={i < score ? cls : ''} />
      ))}
    </span>
  );
  return (
    <header className="topbar">
      <div className="round">
        <strong>
          回合 {view.round}
          <span className="muted">/{view.maxRounds}</span>
        </strong>
      </div>
      <div className="scores" aria-label={`比分 你 ${view.me.score} 分，對手 ${view.opponent.score} 分`}>
        <div className="score me">
          <span className="name">{view.me.nickname}</span>
          <span key={view.me.score} ref={myRef} className="num">{view.me.score}</span>
          {pips(view.me.score, 'me')}
        </div>
        <span className="colon">:</span>
        <div className="score opp">
          <span key={view.opponent.score} ref={oppRef} className="num">{view.opponent.score}</span>
          <span className="name">
            {view.opponent.nickname}
            {!view.opponent.connected && <em className="offline">斷線</em>}
          </span>
          {pips(view.opponent.score, 'opp')}
        </div>
      </div>
      <div className="phase">
        <span>{PHASE_LABEL[view.phase]}</span>
        <TimerRing deadline={view.phase === 'duel' ? null : view.deadline} total={PHASE_TOTAL(view)} />
        <HudButtons />
      </div>
    </header>
  );
}

export function FactItem({ fact, fresh, note, strong }: { fact: Fact; fresh?: boolean; note?: string; strong?: boolean }) {
  return (
    <li className={`fact${fresh ? ' fresh' : ''}${strong ? ' key' : ''}`}>
      <span className="fact-role">
        <Icon name={fact.icon ?? (fact.role ? ROLE_ICONS[fact.role] : 'search')} size={16} color="var(--verify)" />
        {fact.role && ROLE_LABEL[fact.role]}
        {note && <em>{note}</em>}
      </span>
      <span className="fact-text">{fact.content}</span>
      <span className="fact-source">{fact.source_name}</span>
    </li>
  );
}

/** 一個議題的查證資訊：預設收合，點擊才展開（同議題的資訊收在一起）。 */
function TopicFacts({ label, facts, total, fresh }: { label: string; facts: Fact[]; total: number; fresh?: string[] }) {
  const hasFresh = facts.some((f) => fresh?.includes(f.id));
  return (
    <details className={`topic-facts${hasFresh ? ' has-fresh' : ''}`}>
      <summary>
        <Icon name="search" size={15} color="var(--verify)" />
        <span>{label}</span>
        <span className="tf-count">
          {facts.length}/{total} 筆
        </span>
        {hasFresh && <em className="tf-new">新</em>}
      </summary>
      <ul className="facts compact">
        {facts.map((f) => (
          <FactItem key={f.id} fact={f} fresh={fresh?.includes(f.id)} />
        ))}
        {Array.from({ length: total - facts.length }, (_, i) => (
          <li key={`u${i}`} className="fact unknown">
            ?
          </li>
        ))}
      </ul>
    </details>
  );
}

/** judging：判斷卡已經顯示對手的消息與資訊，面板就不再重複。 */
function InfoPanel({ view, collapsed, onToggle, judging }: { view: PlayerView; collapsed: boolean; onToggle: () => void; judging: boolean }) {
  const { freshFacts } = useNet();
  const shared = view.sharedInfo;
  const opp = view.opponent;
  if (collapsed) {
    return (
      <aside className="panel collapsed" aria-label="共同資訊區（已收合）">
        <button className="panel-tab" onClick={onToggle} aria-expanded="false" aria-label="展開共同資訊區">
          <Icon name="search" size={16} color="var(--verify)" />
          <span aria-hidden>◂</span>
        </button>
      </aside>
    );
  }
  // 只在對手有動作時顯示一句短狀態
  const status = !shared
    ? opp.selected
      ? '對手已出牌'
      : null
    : opp.locked
      ? '對手已判斷'
      : shared.myMessage.revealed.length || opp.functionsUsedCount
        ? `對手查證 ${shared.myMessage.revealed.length}・功能卡 ${opp.functionsUsedCount}`
        : null;
  return (
    <aside className="panel" aria-label="共同資訊區">
      <h2>
        <Icon name="search" color="var(--verify)" /> 資訊
        <button className="btn ghost small panel-toggle" onClick={onToggle} aria-expanded="true" aria-label="收合共同資訊區">
          ▸
        </button>
      </h2>
      {shared && (
        <>
          {!judging && (
            <section className="msg-block opp">
              <div className="msg-head">
                <span>
                  <Icon name={CATEGORY_ICONS[shared.opponentMessage.message.category]} size={16} /> 對手
                </span>
                <Dots n={shared.opponentMessage.message.difficulty} color="var(--opponent)" />
              </div>
              <p className="statement">「{shared.opponentMessage.message.statement}」</p>
              <TopicFacts
                key={shared.opponentMessage.message.topicId}
                label={shared.opponentMessage.message.topicTitle}
                facts={shared.opponentMessage.revealed}
                total={shared.opponentMessage.message.factCount}
                fresh={freshFacts}
              />
            </section>
          )}
          <section className="msg-block mine">
            <div className="msg-head">
              <span>我</span>
              {shared.myMessage.message.answer !== undefined && <AnswerBadge answer={shared.myMessage.message.answer} />}
            </div>
            <p className="statement small">「{shared.myMessage.message.statement}」</p>
            {(judging || shared.myMessage.message.topicId !== shared.opponentMessage.message.topicId) && (
              <TopicFacts
                key={shared.myMessage.message.topicId}
                label={shared.myMessage.message.topicTitle}
                facts={shared.myMessage.revealed}
                total={shared.myMessage.message.factCount}
              />
            )}
          </section>
        </>
      )}
      {status && (
        <p className="opp-status">
          <Icon name="eye" size={16} color="var(--opponent)" /> {status}
        </p>
      )}
      <Library view={view} />
    </aside>
  );
}

/** 本局資訊庫：整局累積公開的查證資訊，每個議題各自收合（企畫書第 6 節）。 */
function Library({ view }: { view: PlayerView }) {
  const current = new Set([view.sharedInfo?.opponentMessage.message.topicId, view.sharedInfo?.myMessage.message.topicId]);
  const others = view.library.filter((t) => !current.has(t.topicId));
  if (!others.length) return null;
  return (
    <section className="library">
      <h3>
        <Icon name="layers" size={16} color="var(--verify)" /> 本局資訊庫
      </h3>
      {others.map((t) => (
        <TopicFacts key={t.topicId} label={t.title} facts={t.facts} total={t.factCount} />
      ))}
    </section>
  );
}

function MessageChooser({ view, hidden }: { view: PlayerView; hidden: boolean }) {
  return (
    <div className={`chooser${hidden ? ' a11y-only' : ''}`}>
      <div className="choices">
        {view.me.messageHand.map((m) => (
          <button key={m.id} className="msg-choice" onClick={() => actions.selectMessage(m.id)}>
            <span className="msg-head">
              <span>
                <Icon name={CATEGORY_ICONS[m.category]} size={16} /> {m.topicTitle}
              </span>
              <Dots n={m.difficulty} color="var(--me)" />
            </span>
            <span className="statement">「{m.statement}」</span>
            {m.answer !== undefined && (
              <span className="msg-foot">
                <AnswerBadge answer={m.answer} />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

const HOLD_TIP = '不確定，就先不相信、不轉發';

/** 已啟用的功能卡效果，只用短標籤表示。 */
function EffectTags({ me }: { me: PlayerView['me'] }) {
  const { double, conservative, careful } = me.effects;
  if (!double && !conservative && !careful) return null;
  return (
    <div className="effects" aria-live="polite">
      {double && <span className="tag fn">×2</span>}
      {conservative && <span className="tag fn">保守</span>}
      {careful && <span className="tag fn">謹慎</span>}
    </div>
  );
}

function ActionTray({ view, onJudge, webgl }: { view: PlayerView; onJudge: (c: Choice) => void; webgl: boolean }) {
  const me = view.me;
  const groups = useMemo(() => {
    const m = new Map<string, UtilityCard[]>();
    for (const c of me.utilityHand) m.set(c.name, [...(m.get(c.name) ?? []), c]);
    return m;
  }, [me.utilityHand]);
  const verify = groups.get('verify') ?? [];
  const verifyStatus = verify[0] ? me.cardStatus[verify[0].uid] : { usable: false, reason: '手上沒有查證卡' };
  const locked = me.locked;

  const trayClass = `tray${webgl ? ' a11y-only' : ''}`;
  if (locked) {
    return (
      <div className={trayClass}>
        <p className="locked">
          <strong className={`c-${me.choice}`}>「{CHOICE_LABEL[me.choice!]}」</strong>・等待對手…
        </p>
      </div>
    );
  }

  return (
    <div className={trayClass}>
      <div className="cards-row" role="group" aria-label="我的實用卡">
        <button
          className="util verify"
          disabled={!verifyStatus?.usable}
          title={verifyStatus?.usable ? CARD_EFFECT.verify : verifyStatus?.reason}
          onClick={() => actions.useVerify()}
        >
          <Icon name="search" size={22} />
          <span className="u-name">
            查證 <b>×{verify.length}</b>
          </span>
        </button>
        {FUNCTION_ORDER.filter((n) => groups.has(n)).map((name) => {
          const cards = groups.get(name)!;
          const st = me.cardStatus[cards[0].uid];
          return (
            <button
              key={name}
              className={`util fn${name === 'direct_duel' ? ' duel' : ''}`}
              disabled={!st?.usable}
              title={st?.usable ? CARD_EFFECT[name] : st?.reason}
              onClick={() => actions.useFunction(name as FunctionName)}
            >
              <Icon name={CARD_ICONS[name as FunctionName]} size={22} />
              <span className="u-name">
                {CARD_NAME[name as FunctionName]}
                {cards.length > 1 && <b> ×{cards.length}</b>}
              </span>
            </button>
          );
        })}
      </div>
      <EffectTags me={me} />
      <div className="judge-row" role="group" aria-label="判斷">
        {(['true', 'false', 'hold'] as Choice[]).map((c) => (
          <button key={c} className={`judge c-${c}`} onClick={() => onJudge(c)} title={c === 'hold' ? HOLD_TIP : undefined}>
            <Icon name={CHOICE_ICONS[c]} size={26} strokeWidth={2.5} />
            <span>{CHOICE_LABEL[c]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 判斷卡：對手的消息、這個議題已公開的查證資訊、判斷按鈕合在同一張浮出的大卡上，
 * 放在畫面上方，不擋住下方的手牌（企畫書 13.1）。新查到的資訊會亮起並噴出像素。
 */
function JudgeCard({ view, onJudge, focusFact }: { view: PlayerView; onJudge: (c: Choice) => void; focusFact: string | null }) {
  const info = view.sharedInfo!.opponentMessage;
  const me = view.me;
  const m = info.message;
  const [justFound, setJustFound] = useState<string[]>([]);
  const seen = useRef<{ key: string; ids: Set<string> }>({ key: '', ids: new Set() });
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const key = `${view.round}:${m.id}`;
    const ids = new Set(info.revealed.map((f) => f.id));
    const prev = seen.current;
    seen.current = { key, ids };
    if (prev.key !== key) return;
    const fresh = info.revealed.filter((f) => !prev.ids.has(f.id)).map((f) => f.id);
    if (!fresh.length) return;
    setJustFound(fresh);
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-fact="${fresh[0]}"]`);
      burstAt(el ?? null, ['#F2FF3A', '#B6FF9E', '#FFFFFF'], 36);
    });
    const t = setTimeout(() => setJustFound([]), 3500);
    return () => clearTimeout(t);
  }, [info, view.round, m.id]);
  const hidden = m.factCount - info.revealed.length;
  return (
    <section className="judge-card" aria-label="判斷對手的消息">
      <div className="jc-head">
        <span>
          <Icon name={CATEGORY_ICONS[m.category]} size={16} /> {m.topicTitle}
        </span>
        <Dots n={m.difficulty} color="var(--opponent)" />
      </div>
      <p className="jc-statement">「{m.statement}」</p>
      <ul className="jc-facts" ref={listRef}>
        {info.revealed.map((f) => (
          <li
            key={f.id}
            data-fact={f.id}
            className={`jc-fact${justFound.includes(f.id) ? ' just' : ''}${focusFact === f.id ? ' focus' : ''}`}
          >
            <Icon name="search" size={16} color="var(--verify)" />
            <span className="jc-fact-text">{f.content}</span>
            <span className="jc-fact-src">{f.source_name}</span>
            {justFound.includes(f.id) && <em className="jc-new">新</em>}
          </li>
        ))}
        {Array.from({ length: hidden }, (_, i) => (
          <li key={`h${i}`} className="jc-fact unknown" aria-label="尚未查證">
            ?
          </li>
        ))}
      </ul>
      {me.locked ? (
        <p className="jc-wait">
          <strong className={`c-${me.choice}`}>「{CHOICE_LABEL[me.choice!]}」</strong>・等待對手…
        </p>
      ) : (
        <div className="judge-row jc-buttons" role="group" aria-label="判斷">
          {(['true', 'false', 'hold'] as Choice[]).map((ch) => (
            <button key={ch} className={`judge c-${ch}`} onClick={() => onJudge(ch)} title={ch === 'hold' ? HOLD_TIP : undefined}>
              <Icon name={CHOICE_ICONS[ch]} size={24} strokeWidth={2.5} />
              <span>{CHOICE_LABEL[ch]}</span>
            </button>
          ))}
        </div>
      )}
      <EffectTags me={me} />
    </section>
  );
}

/** 回合結算時先在場地播放加扣分演出，約 2.6 秒後才跳出結果視窗。 */
function useResultDelay(view: PlayerView, webgl: boolean) {
  const [readyRound, setReadyRound] = useState<number | null>(null);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const wait = webgl && !reduced ? 2600 : 0;
  useEffect(() => {
    if (view.phase !== 'round_result') return;
    const t = setTimeout(() => setReadyRound(view.round), wait);
    return () => clearTimeout(t);
  }, [view.phase, view.round, wait]);
  return view.phase === 'round_result' && readyRound === view.round;
}

export function Game({ view }: { view: PlayerView }) {
  const { investigate, peek } = useNet();
  const [confirm, setConfirm] = useState<Choice | null>(null);
  const webgl = useMemo(hasWebGL, []);
  const resultReady = useResultDelay(view, webgl);
  const [focusFact, setFocusFact] = useState<string | null>(null);
  // 共同資訊區可以整個收合，記在這台電腦上
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    try {
      return localStorage.getItem('zj_panel_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const togglePanel = () =>
    setPanelCollapsed((v) => {
      try {
        localStorage.setItem('zj_panel_collapsed', v ? '0' : '1');
      } catch {
        /* 無法儲存就只在這次有效 */
      }
      return !v;
    });
  useEffect(() => {
    if (!focusFact) return;
    const t = setTimeout(() => setFocusFact(null), 2000);
    return () => clearTimeout(t);
  }, [focusFact]);
  const onUseCard = (c: UtilityCard) => (c.name === 'verify' ? actions.useVerify() : actions.useFunction(c.name));

  if (view.phase === 'game_over') return <FinalScreen view={view} />;

  return (
    <div className={`game${webgl ? '' : ' no-webgl'}${panelCollapsed ? ' panel-collapsed' : ''}`}>
      {!webgl && <TopBar view={view} />}
      <div className="board">
        {webgl && (
          <Scene
            view={view}
            onSelectMessage={actions.selectMessage}
            onUseCard={onUseCard}
            onFactClick={(f) => setFocusFact(f.id)}
          />
        )}
        {webgl && <Hud view={view} />}
        {webgl && view.phase === 'action' && view.sharedInfo && (
          <JudgeCard view={view} onJudge={setConfirm} focusFact={focusFact} />
        )}
        {!webgl && (
          <div className="banner" aria-live="polite">
            {view.phase === 'select_message' && (view.me.selected ? '等待對手…' : '選一張消息卡')}
            {view.phase === 'action' && view.me.locked && '等待對手…'}
          </div>
        )}
      </div>
      <InfoPanel
        view={view}
        collapsed={panelCollapsed}
        onToggle={togglePanel}
        judging={webgl && view.phase === 'action' && Boolean(view.sharedInfo)}
      />
      <div className="bottom">
        {view.phase === 'select_message' && !view.me.selected && <MessageChooser view={view} hidden={webgl} />}
        {view.phase === 'action' && <ActionTray view={view} onJudge={setConfirm} webgl={webgl} />}
      </div>
      {confirm && view.phase === 'action' && !view.me.locked && (
        <Modal label="確認判斷">
          <h3>
            確定選「<span className={`c-${confirm}`}>{CHOICE_LABEL[confirm]}</span>」？
          </h3>
          <div className="row">
            <button className="btn" onClick={() => setConfirm(null)}>
              再想想
            </button>
            <button
              className={`btn solid c-${confirm}`}
              onClick={(e) => {
                burstAt(e.currentTarget, [{ true: '#00FF9C', false: '#FF3355', hold: '#7C9A88' }[confirm], '#FFFFFF'], 30);
                actions.judge(confirm);
                setConfirm(null);
              }}
            >
              確定
            </button>
          </div>
        </Modal>
      )}
      {view.phase === 'duel' && view.duel && <DuelOverlay view={view} />}
      <Coach view={view} />
      {view.phase === 'round_result' && resultReady && <RoundResultOverlay view={view} />}
      {investigate && <InvestigateModal count={investigate.count} />}
      {peek && <PeekModal />}
      {webgl && <HoverTip />}
    </div>
  );
}
