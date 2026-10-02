// 滑鼠停在手牌上時顯示的說明框（卡面保持乾淨，詳情只在指到時出現）。
import { useSyncExternalStore } from 'react';
import type { CardStatus, MessageView, UtilityName } from '../../shared/types';

export type HoverInfo =
  | { kind: 'utility'; name: UtilityName; status: CardStatus; x: number; y: number }
  | { kind: 'message'; message: MessageView; selectable: boolean; x: number; y: number };

let hover: HoverInfo | null = null;
const listeners = new Set<() => void>();

export function setHover(h: HoverInfo | null) {
  hover = h;
  listeners.forEach((l) => l());
}

export const useHover = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hover,
  );
