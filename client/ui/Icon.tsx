import { createElement } from 'react';
import { ICONS } from '../../shared/icons';

/** 以共用圖示庫繪製 Lucide 線條圖示（線寬 1.5，企畫書 14.3）。 */
export function Icon({ name, size = 20, color = 'currentColor', strokeWidth = 1.5, label }: {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  label?: string;
}) {
  const node = ICONS[name];
  if (!node) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ flex: 'none' }}
    >
      {node.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
