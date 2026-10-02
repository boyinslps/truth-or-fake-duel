// 回饋視窗：學生對遊戲寫下想法，老師在老師頁看得到（企畫書第 20 節）。
import { useEffect, useState } from 'react';
import { actions, useNet } from '../net';
import { Modal } from './common';

const MAX = 300;

export function FeedbackModal() {
  const { feedbackOpen, feedbackResult } = useNet();
  const [text, setText] = useState('');
  useEffect(() => {
    if (!feedbackResult?.ok) return;
    setText('');
    const t = setTimeout(actions.closeFeedback, 1600);
    return () => clearTimeout(t);
  }, [feedbackResult]);
  if (!feedbackOpen) return null;
  const sent = feedbackResult?.ok;
  return (
    <Modal label="回饋">
      <h3>寫下你的想法</h3>
      {sent ? (
        <p className="c-true">謝謝你！老師會看到。</p>
      ) : (
        <>
          <textarea
            className="feedback-text"
            value={text}
            maxLength={MAX}
            rows={5}
            autoFocus
            placeholder="哪裡好玩？哪裡看不懂？有什麼想要的？"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="feedback-foot">
            <span className="muted">
              {text.length}/{MAX}
            </span>
            {feedbackResult && !feedbackResult.ok && <span className="notice warn">{feedbackResult.message}</span>}
          </div>
        </>
      )}
      <div className="row end">
        <button className="btn ghost" onClick={actions.closeFeedback}>
          {sent ? '關閉' : '取消'}
        </button>
        {!sent && (
          <button className="btn primary" disabled={!text.trim()} onClick={() => actions.submitFeedback(text)}>
            送出
          </button>
        )}
      </div>
    </Modal>
  );
}
