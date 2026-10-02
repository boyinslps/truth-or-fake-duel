// 新手教學（企畫書第 20 節）：教學對局裡，每走到一個新步驟就跳出一個說明框；
// 遊戲中的「教學」按鈕則列出全部步驟，隨時可以回頭看。
import { useEffect, useState } from 'react';
import type { PlayerView } from '../../shared/types';
import { actions, useNet } from '../net';
import { Modal } from './common';

interface Step {
  id: string;
  title: string;
  body: string;
  /** 走到這一步的條件。 */
  when: (v: PlayerView) => boolean;
  /** 條件成立後等一下才跳出（讓動畫先演完），毫秒。 */
  delay?: number;
}

export const STEPS: Step[] = [
  {
    id: 'select',
    title: '出牌',
    body: '每回合雙方各從手牌選 1 則消息打出。你看得到自己手牌的答案（○ 是真的、× 是假的），對手看不到。挑一張，點它打出去！',
    when: (v) => v.phase === 'select_message' && v.round === 1 && !v.me.selected,
    delay: 700,
  },
  {
    id: 'verify',
    title: '查證',
    body: '兩張牌翻開了。上方是對手的消息，你不知道它是真是假。先查證：點手牌裡黃色的「查證」卡，會公開一筆證據。',
    when: (v) => v.phase === 'action' && v.round === 1 && !v.me.locked && (v.sharedInfo?.opponentMessage.revealed.length ?? 0) === 0,
    delay: 600,
  },
  {
    id: 'judge',
    title: '判斷',
    body: '黃色的就是查到的證據，同一個議題的證據整局都保留。證據夠了，就選「是真的」或「是假的」；沒把握可以選「暫不判斷」，不扣分。',
    when: (v) => v.phase === 'action' && v.round === 1 && !v.me.locked && (v.sharedInfo?.opponentMessage.revealed.length ?? 0) > 0,
    delay: 500,
  },
  {
    id: 'result',
    title: '結算',
    body: '判斷正確 +1、判斷錯誤 −1、暫不判斷 0。做出判斷會抽到 1 張實用卡。看看下面的解釋，學到為什麼是真或假，再按「繼續」。',
    when: (v) => v.phase === 'round_result' && v.round === 1,
    delay: 3300,
  },
  {
    id: 'cards',
    title: '功能卡',
    body: '功能卡能改變這回合：「加倍」得失分 ×2、「保守」答錯不扣分、「事先調查」偷看對手的手牌。滑鼠指到手牌就會顯示說明。這回合試著用一張再判斷吧！',
    when: (v) => v.phase === 'action' && v.round === 2 && !v.me.locked,
    delay: 600,
  },
  {
    id: 'finish',
    title: '開始對戰',
    body: '正式比賽先得到 7 分的人獲勝；如果雙方都到了 7 分，之後誰先領先誰就贏，最多 12 回合。教學不計牌位，準備好就回首頁按「開始對戰」！',
    when: (v) => v.phase === 'game_over' && v.gameOver?.reason !== 'forfeit',
    delay: 800,
  },
];

/** 教學對局的引導視窗：一次一個步驟，按「知道了」才繼續。 */
export function Coach({ view }: { view: PlayerView }) {
  const [seen, setSeen] = useState<string[]>([]);
  const step = view.tutorial ? STEPS.find((s) => !seen.includes(s.id) && s.when(view)) : undefined;
  const [shown, setShown] = useState<string | null>(null);
  const id = step?.id ?? null;
  useEffect(() => {
    setShown(null);
    if (!step) return;
    const t = setTimeout(() => setShown(step.id), step.delay ?? 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!step || shown !== step.id) return null;
  const n = STEPS.indexOf(step) + 1;
  return (
    <div className="coach-backdrop">
      <div className="coach" role="dialog" aria-modal="true" aria-label={`教學 ${n}`}>
        <div className="coach-head">
          <span className="coach-step">教學 {n}/{STEPS.length}</span>
          <strong>{step.title}</strong>
        </div>
        <p>{step.body}</p>
        <div className="row end">
          {view.phase !== 'game_over' && (
            <button className="btn ghost small" onClick={() => actions.leaveGame()}>
              跳過教學
            </button>
          )}
          <button className="btn primary" onClick={() => setSeen((x) => [...x, step.id])}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

/** 遊戲中「教學」按鈕：把全部步驟列出來，隨時回頭看。 */
export function HelpModal() {
  const { helpOpen } = useNet();
  if (!helpOpen) return null;
  return (
    <Modal label="玩法說明" wide>
      <h2>玩法說明</h2>
      <div className="help-grid">
        {STEPS.map((s, i) => (
          <section key={s.id} className="help-item">
            <h4>
              <span className="coach-step">{i + 1}</span> {s.title}
            </h4>
            <p>{s.body}</p>
          </section>
        ))}
      </div>
      <div className="row end">
        <button className="btn primary" onClick={actions.closeHelp}>
          關閉
        </button>
      </div>
    </Modal>
  );
}
