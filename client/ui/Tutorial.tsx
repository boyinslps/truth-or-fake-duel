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
    body: `下面是你的手牌。
選一張綠色的「消息卡」，點一下，就打出去了。
卡片角落的 ○ 是「真的」，× 是「假的」。只有你看得到，對手看不到喔！`,
    when: (v) => v.phase === 'select_message' && v.round === 1 && !v.me.selected,
    delay: 1200,
  },
  {
    id: 'look',
    title: '看對手的牌',
    body: `兩張牌翻開了！
上面那張是對手的消息。
你不知道它是真的還是假的，要靠「證據」來猜。`,
    when: (v) => v.phase === 'action' && v.round === 1 && !v.me.locked,
    delay: 1500,
  },
  {
    id: 'verify',
    title: '查證',
    body: `點手牌裡黃色的「查證」卡，
就會出現一個證據。
證據會出現在上面的黃色框框裡。`,
    when: (v) => v.phase === 'action' && v.round === 1 && !v.me.locked,
    delay: 300,
  },
  {
    id: 'judge',
    title: '判斷',
    body: `看看黃色的證據。
你覺得對手的消息是真的還是假的？
按下面的按鈕：是真的、是假的，或是「暫不判斷」。`,
    when: (v) => v.phase === 'action' && v.round === 1 && !v.me.locked && (v.sharedInfo?.opponentMessage.revealed.length ?? 0) > 0,
    delay: 1200,
  },
  {
    id: 'hold',
    title: '沒把握怎麼辦？',
    body: `還不確定的時候，可以選「暫不判斷」。
這樣不加分，也不扣分。
不確定就先不要相信，也不要亂轉傳！`,
    when: (v) => v.phase === 'action' && v.round === 1 && !v.me.locked && (v.sharedInfo?.opponentMessage.revealed.length ?? 0) > 0,
    delay: 300,
  },
  {
    id: 'result',
    title: '算分',
    body: `判斷對了，加 1 分。
判斷錯了，扣 1 分。
選「暫不判斷」，0 分。
看一看下面的說明，知道為什麼，再按「繼續」。`,
    when: (v) => v.phase === 'round_result' && v.round === 1,
    delay: 3800,
  },
  {
    id: 'draw',
    title: '抽新卡',
    body: `做出判斷之後，你會抽到一張新的卡。
新卡會從右邊的牌堆飛進你的手牌！`,
    when: (v) => v.phase === 'round_result' && v.round === 1,
    delay: 300,
  },
  {
    id: 'cards',
    title: '功能卡',
    body: `紫色的是「功能卡」，很好用：
「加倍」＝分數變兩倍
「保守」＝答錯不扣分
把滑鼠移到卡片上，就會看到說明。這一回合，試試看用一張吧！`,
    when: (v) => v.phase === 'action' && v.round === 2 && !v.me.locked,
    delay: 1500,
  },
  {
    id: 'finish',
    title: '教學完成！',
    body: `你學會了！
正式比賽是誰先得 7 分，誰就贏。
準備好了，就回首頁按「開始對戰」！`,
    when: (v) => v.phase === 'game_over' && v.gameOver?.reason !== 'forfeit',
    delay: 1200,
  },
];

/** 教學對局的引導視窗：一次一個步驟，按「下一步」才繼續。 */
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
        <p className="coach-body">{step.body}</p>
        <div className="row end">
          {view.phase !== 'game_over' && (
            <button className="btn ghost small" onClick={() => actions.leaveGame()}>
              跳過教學
            </button>
          )}
          <button className="btn primary" onClick={() => setSeen((x) => [...x, step.id])}>
            下一步
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
            <p className="coach-body">{s.body}</p>
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
