// 畫面層（HTML 之上）的像素粒子：方塊、位置對齊 6px 格線、透明度分段遞減，呈現像素風格。
const PIXEL = 6;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  color: string;
  size: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let parts: P[] = [];
let running = false;
let last = 0;

function ensure() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'pixel-fx';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  const fit = () => {
    canvas!.width = window.innerWidth;
    canvas!.height = window.innerHeight;
    ctx!.imageSmoothingEnabled = false;
  };
  fit();
  window.addEventListener('resize', fit);
}

function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
  parts = parts.filter((p) => p.age < p.life);
  for (const p of parts) {
    p.age += dt;
    p.vy += 900 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const left = 1 - p.age / p.life;
    ctx!.globalAlpha = Math.ceil(left * 4) / 4; // 分四段淡出，像素感
    ctx!.fillStyle = p.color;
    const s = p.size;
    ctx!.fillRect(Math.round(p.x / PIXEL) * PIXEL, Math.round(p.y / PIXEL) * PIXEL, s, s);
  }
  ctx!.globalAlpha = 1;
  if (parts.length) requestAnimationFrame(frame);
  else running = false;
}

/** 在畫面座標 (x, y) 炸開一團像素。colors 會輪流使用。 */
export function pixelBurst(x: number, y: number, colors: string[], count = 28, power = 1) {
  if (typeof window === 'undefined' || reduced()) return;
  ensure();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (160 + Math.random() * 260) * power;
    parts.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 260 * power,
      life: 0.55 + Math.random() * 0.45,
      age: 0,
      color: colors[i % colors.length],
      size: Math.random() < 0.3 ? PIXEL * 2 : PIXEL,
    });
  }
  if (!running) {
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
}

/** 在某個元素的中心炸開像素。 */
export function burstAt(el: Element | null, colors: string[], count?: number, power?: number) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  pixelBurst(r.left + r.width / 2, r.top + r.height / 2, colors, count, power);
}
