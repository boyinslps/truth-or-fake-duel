import { useEffect, useState, type ReactNode } from 'react';
import { remainingMs, useNet } from '../net';
import { Icon } from './Icon';
import type { Choice } from '../../shared/types';
import { CHOICE_ICONS } from '../../shared/icons';
import { CHOICE_LABEL } from '../labels';

/** 每 200 ms 重畫一次，給倒數用。 */
export function useTicker(ms = 200) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function seconds(deadline: number | null) {
  return Math.ceil(remainingMs(deadline) / 1000);
}

/** 環形倒數。 */
export function TimerRing({ deadline, total, size = 44, color = 'var(--me)' }: {
  deadline: number | null;
  total: number;
  size?: number;
  color?: string;
}) {
  useTicker();
  const left = remainingMs(deadline) / 1000;
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const p = total > 0 ? Math.min(1, left / total) : 0;
  const urgent = deadline !== null && left <= 10;
  return (
    <div className={`timer-ring${urgent ? ' urgent' : ''}`} style={{ width: size, height: size }} role="timer" aria-label={`剩 ${Math.ceil(left)} 秒`}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--grid)" strokeWidth={4} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={urgent ? 'var(--false)' : color}
          strokeWidth={4}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span>{deadline === null ? '–' : Math.ceil(left)}</span>
    </div>
  );
}

export function ChoiceBadge({ choice, size = 18 }: { choice: Choice; size?: number }) {
  return (
    <span className={`choice-badge c-${choice}`}>
      <Icon name={CHOICE_ICONS[choice]} size={size} strokeWidth={2.5} />
      {CHOICE_LABEL[choice]}
    </span>
  );
}

export function AnswerBadge({ answer }: { answer: boolean }) {
  return (
    <span className={`answer-badge ${answer ? 'c-true' : 'c-false'}`}>
      <Icon name={answer ? 'circle' : 'x'} size={16} strokeWidth={2.5} />
      {answer ? '真' : '假'}
    </span>
  );
}

export function Modal({ children, label, wide }: { children: ReactNode; label: string; wide?: boolean }) {
  return (
    <div className="modal-backdrop">
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useNet();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast tone-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Dots({ n, max = 3, color }: { n: number; max?: number; color: string }) {
  return (
    <span className="dots" aria-label={`難度 ${n}`}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} style={{ background: i < n ? color : 'var(--grid)' }} />
      ))}
    </span>
  );
}
