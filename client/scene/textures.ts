// 卡面貼圖：用 Canvas 繪製文字與圖示，再交給 three.js（企畫書 14.5、14.7）。
// 視覺主題：黑底、霓虹綠的代碼世界（駭客任務風）。
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { ICONS, type IconNode } from '../../shared/icons';

export const COLORS = {
  bg: '#020A05',
  grid: '#0F4F2B',
  gridMajor: '#1B9E55',
  panel: '#06170D',
  ink: '#D4FFE2',
  inkSoft: '#7CCF9B',
  me: '#00FF66',
  opponent: '#2DE2E6',
  true: '#00FF9C',
  false: '#FF3355',
  hold: '#7C9A88',
  verify: '#F2FF3A',
  function: '#C07CFF',
  duel: '#FF3DA5',
};

export const FONT = '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", "Heiti TC", sans-serif';
const MONO = '"Roboto Mono", ui-monospace, monospace';

export function drawIcon(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, size: number, color: string, width = 1.5) {
  const node: IconNode | undefined = ICONS[name];
  if (!node) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [tag, a] of node) {
    const n = (k: string) => Number(a[k] ?? 0);
    ctx.beginPath();
    if (tag === 'path') {
      ctx.stroke(new Path2D(String(a.d)));
      continue;
    }
    if (tag === 'circle') ctx.arc(n('cx'), n('cy'), n('r'), 0, Math.PI * 2);
    else if (tag === 'ellipse') ctx.ellipse(n('cx'), n('cy'), n('rx'), n('ry'), 0, 0, Math.PI * 2);
    else if (tag === 'rect') ctx.roundRect(n('x'), n('y'), n('width'), n('height'), n('rx'));
    else if (tag === 'line') {
      ctx.moveTo(n('x1'), n('y1'));
      ctx.lineTo(n('x2'), n('y2'));
    } else if (tag === 'polyline' || tag === 'polygon') {
      const pts = String(a.points).trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i < pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, pts[i], pts[i + 1]);
      if (tag === 'polygon') ctx.closePath();
    }
    ctx.stroke();
  }
  ctx.restore();
}

const NO_LINE_START = new Set([...'，。、；：！？）」』%']);

/** 中文逐字換行；標點不放在行首。 */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line && !NO_LINE_START.has(ch)) {
      lines.push(line);
      line = ch;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number, size: number, weight = 700) {
  let s = size;
  let lines: string[] = [];
  for (; s >= 18; s -= 2) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines) break;
  }
  return { size: s, lines };
}

// ───────────── 共用繪圖 ─────────────

const INSET = 14;

/** 深色卡面＋霓虹外框（外框先畫一層模糊的光暈，再畫實線）。 */
function panel(ctx: CanvasRenderingContext2D, w: number, h: number, border: string, tint = COLORS.panel) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.roundRect(INSET, INSET, w - INSET * 2, h - INSET * 2, 28);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = border;
  ctx.shadowBlur = 22;
  ctx.lineWidth = 8;
  ctx.strokeStyle = border;
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = 6;
  ctx.strokeStyle = border;
  ctx.stroke();
}

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄ0123456789ABCDEF<>/{}[]=+*';

function seededRandom(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** 代碼雨：一排排往下掉的字元，越靠下越亮，最前面那個最亮。 */
function codeRain(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, alpha: number, seed: number, size = 22) {
  const rnd = seededRandom(seed);
  ctx.save();
  ctx.font = `700 ${size}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const cols = Math.floor(w / size);
  const rows = Math.floor(h / size);
  for (let c = 0; c < cols; c++) {
    const len = 4 + Math.floor(rnd() * 12);
    const start = Math.floor(rnd() * rows) - len;
    for (let k = 0; k < len; k++) {
      const row = start + k;
      if (row < 0 || row >= rows) continue;
      const head = k === len - 1;
      ctx.globalAlpha = head ? Math.min(1, alpha * 3) : alpha * ((k + 1) / len);
      ctx.fillStyle = head ? '#E8FFF0' : color;
      ctx.fillText(GLYPHS[Math.floor(rnd() * GLYPHS.length)], c * size + size / 2, row * size);
    }
  }
  ctx.restore();
}

const cache = new Map<string, CanvasTexture>();

function make(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** 字型下載完成後要重畫卡面：清掉快取。 */
export function clearTextureCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

const PORTRAIT: [number, number] = [512, 716]; // 63:88
const LANDSCAPE: [number, number] = [512, 326]; // 88:56

// ───────────── 消息卡 ─────────────

export function messageFace(o: {
  id: string;
  statement: string;
  category: string;
  categoryIcon: string;
  difficulty: number;
  owner: 'me' | 'opponent';
  answer?: boolean;
}) {
  const [w, h] = PORTRAIT;
  return make(`msg:${o.id}:${o.owner}:${o.answer}`, w, h, (ctx) => {
    const border = o.owner === 'me' ? COLORS.me : COLORS.opponent;
    panel(ctx, w, h, border);
    drawIcon(ctx, o.categoryIcon, 44, 40, 54, border, 2.2);
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(w - 60 - i * 30, 67, 10, 0, Math.PI * 2);
      ctx.fillStyle = i < o.difficulty ? border : COLORS.grid;
      ctx.fill();
    }
    const { size, lines } = fitText(ctx, o.statement, w - 96, 6, 56);
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    const lh = size * 1.35;
    const top = h / 2 + 10 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, top + i * lh));
    if (o.answer !== undefined) {
      const c = o.answer ? COLORS.true : COLORS.false;
      drawIcon(ctx, o.answer ? 'circle' : 'x', w - 90, h - 90, 48, c, 3);
    }
  });
}

/** 消息牌背：我方綠、對手青，代碼雨圖案，不放字（牌背翻面時字會倒過來）。 */
export function messageBack(owner: 'me' | 'opponent' = 'me') {
  const [w, h] = PORTRAIT;
  return make(`msg:back:${owner}`, w, h, (ctx) => {
    const col = owner === 'me' ? COLORS.me : COLORS.opponent;
    panel(ctx, w, h, col, '#020D06');
    codeRain(ctx, w, h, col, 0.5, owner === 'me' ? 11 : 23, 24);
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(44, 44, w - 88, h - 88, 18);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 中央放圖示，底下墊一塊黑底讓圖示清楚
    ctx.fillStyle = '#020D06';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 118, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 20;
    drawIcon(ctx, 'message-square-text', w / 2 - 85, h / 2 - 85, 170, col, 2);
    ctx.restore();
  });
}

/** 實用卡牌背（牌庫用）：紫色代碼雨，放大鏡與閃電圖示。 */
export function utilityBack() {
  const [w, h] = PORTRAIT;
  return make('util:back', w, h, (ctx) => {
    panel(ctx, w, h, COLORS.function, '#0B0614');
    codeRain(ctx, w, h, COLORS.function, 0.5, 37, 24);
    ctx.strokeStyle = COLORS.function;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(44, 44, w - 88, h - 88, 18);
    ctx.stroke();
    ctx.fillStyle = '#0B0614';
    ctx.beginPath();
    ctx.roundRect(w / 2 - 170, h / 2 - 100, 340, 200, 24);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = COLORS.verify;
    ctx.shadowBlur = 16;
    drawIcon(ctx, 'search', w / 2 - 150, h / 2 - 75, 150, COLORS.verify, 2);
    ctx.restore();
    ctx.save();
    ctx.shadowColor = COLORS.function;
    ctx.shadowBlur = 16;
    drawIcon(ctx, 'zap', w / 2, h / 2 - 75, 150, '#E9D5FF', 2);
    ctx.restore();
  });
}

/** 實用卡卡面只放圖示與卡名；效果說明在滑鼠指到時才顯示（企畫書 14.5）。 */
export function utilityFace(o: { name: string; label: string; icon: string; color: string; dim?: boolean }) {
  const [w, h] = PORTRAIT;
  return make(`util:${o.name}:${o.dim}`, w, h, (ctx) => {
    const col = o.dim ? '#4D6657' : o.color;
    panel(ctx, w, h, col, o.dim ? '#08100B' : COLORS.panel);
    ctx.fillStyle = col;
    ctx.globalAlpha = o.dim ? 0.08 : 0.14;
    ctx.beginPath();
    ctx.arc(w / 2, 300, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.save();
    if (!o.dim) {
      ctx.shadowColor = col;
      ctx.shadowBlur = 18;
    }
    drawIcon(ctx, o.icon, w / 2 - 105, 195, 210, col, 1.8);
    ctx.restore();
    if (o.name === 'double') {
      ctx.font = `900 60px ${MONO}`;
      ctx.fillStyle = col;
      ctx.textAlign = 'right';
      ctx.fillText('×2', w - 56, 112);
    }
    ctx.fillStyle = o.dim ? '#6B8576' : COLORS.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 66px ${FONT}`;
    ctx.fillText(o.label, w / 2, 575);
  });
}

// ───────────── 查證資訊 ─────────────

export function factFace(o: { id: string; content: string; roleLabel: string; roleIcon: string; source: string; fresh?: boolean }) {
  const [w, h] = LANDSCAPE;
  return make(`fact:${o.id}`, w, h, (ctx) => {
    panel(ctx, w, h, COLORS.verify, '#0E1505');
    drawIcon(ctx, o.roleIcon, 36, 28, 40, COLORS.verify, 2.2);
    ctx.fillStyle = COLORS.verify;
    ctx.font = `700 26px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(o.roleLabel, 86, 48);
    const { size, lines } = fitText(ctx, o.content, w - 76, 4, 32, 500);
    ctx.fillStyle = COLORS.ink;
    const lh = size * 1.3;
    lines.forEach((l, i) => ctx.fillText(l, 36, 106 + i * lh));
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = `500 20px ${FONT}`;
    ctx.fillText(o.source, 36, h - 40);
  });
}

export function factBack() {
  const [w, h] = LANDSCAPE;
  return make('fact:back', w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(14,21,5,0.8)';
    ctx.beginPath();
    ctx.roundRect(10, 10, w - 20, h - 20, 24);
    ctx.fill();
    ctx.setLineDash([14, 10]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = COLORS.verify;
    ctx.stroke();
    ctx.setLineDash([]);
    drawIcon(ctx, 'search', w / 2 - 40, h / 2 - 40, 80, COLORS.verify, 2);
  });
}

// ───────────── 桌面上的文字與標示 ─────────────

/** 牌庫前的剩餘張數：只有數字，像印在桌面上。 */
export function countTexture(n: number) {
  return make(`count:${n}`, 128, 64, (ctx) => {
    ctx.fillStyle = COLORS.inkSoft;
    ctx.font = `700 40px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 64, 34);
  });
}

/** 結算得分（+1 / -1 / 0）：同色光暈、黑色描邊。 */
export function deltaTexture(text: string, color: string) {
  return make(`delta:${text}:${color}`, 256, 160, (ctx) => {
    ctx.font = `700 104px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 26;
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, 128, 84);
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 84);
  });
}

/** 半場的比分牌：暱稱、大字分數、距離目標分的進度格。 */
export function scoreTexture(nickname: string, score: number, target: number, side: 'me' | 'opponent') {
  return make(`score:${side}:${nickname}:${score}:${target}`, 512, 256, (ctx) => {
    const col = side === 'me' ? COLORS.me : COLORS.opponent;
    panel(ctx, 512, 256, col, '#020D06');
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 40px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(nickname.length > 7 ? nickname.slice(0, 7) + '…' : nickname, 50, 66);
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 26;
    ctx.fillStyle = col;
    ctx.font = `700 150px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText(String(score), 462, 140);
    ctx.restore();
    const gap = 8;
    const segW = (512 - 100 - gap * (target - 1)) / target;
    for (let i = 0; i < target; i++) {
      ctx.fillStyle = i < score ? col : COLORS.grid;
      ctx.beginPath();
      ctx.roundRect(50 + i * (segW + gap), 198, segW, 16, 8);
      ctx.fill();
    }
  });
}

/** 桌面：深色底、綠色格線、淡淡的代碼雨。一張可重複的貼圖（取代每個像素都要計算的格線 shader）。 */
export function gridTexture() {
  const t = make('grid', 512, 512, (ctx) => {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, 512, 512);
    codeRain(ctx, 512, 512, '#00FF66', 0.1, 5, 22);
    // 一格 = 102.4px（五格為一個大格 512px）
    for (let i = 0; i <= 5; i++) {
      const major = i === 0 || i === 5;
      ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.grid;
      ctx.lineWidth = major ? 6 : 3;
      const x = Math.min(510, Math.max(1, i * 102.4));
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.moveTo(0, x);
      ctx.lineTo(512, x);
      ctx.stroke();
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** 桌面倒數：圓環＋秒數。直接重畫同一張畫布（每秒一次），不進貼圖快取。 */
export function drawTimer(canvas: HTMLCanvasElement, sec: number, progress: number) {
  const ctx = canvas.getContext('2d')!;
  const c = canvas.width / 2;
  const urgent = sec <= 10;
  const col = urgent ? COLORS.false : COLORS.me;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(2,13,6,0.92)';
  ctx.beginPath();
  ctx.arc(c, c, c - 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = COLORS.grid;
  ctx.beginPath();
  ctx.arc(c, c, c - 28, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = col;
  ctx.shadowBlur = 18;
  ctx.lineCap = 'round';
  ctx.strokeStyle = col;
  ctx.beginPath();
  ctx.arc(c, c, c - 28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, progress));
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = urgent ? COLORS.false : COLORS.ink;
  ctx.font = '700 ' + (sec >= 100 ? 72 : 96) + 'px ' + MONO;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(sec), c, c + 6);
}

export function stampTexture(choice: 'true' | 'false' | 'hold') {
  return make(`stamp:${choice}`, 256, 256, (ctx) => {
    const color = { true: COLORS.true, false: COLORS.false, hold: COLORS.hold }[choice];
    ctx.clearRect(0, 0, 256, 256);
    ctx.globalAlpha = 0.95;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 10;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(128, 128, 104, 0, Math.PI * 2);
    ctx.stroke();
    drawIcon(ctx, { true: 'circle', false: 'x', hold: 'pause' }[choice], 48, 48, 160, color, 3);
  });
}

/** 卡片底下的綠色微光（取代陰影，黑底上陰影看不見）。 */
export function shadowTexture() {
  return make('shadow', 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,255,102,0.3)');
    g.addColorStop(1, 'rgba(0,255,102,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}
