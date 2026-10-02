// three.js 場景：淺色網格上的「查證工作台」（企畫書 14.4–14.6）。
// 場景只負責呈現與點選；所有文字與按鈕另有 HTML 版本，沒有 WebGL 也能玩。
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard, PerformanceMonitor } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, SRGBColorSpace, type Group, type InstancedMesh, type Mesh,
  type MeshBasicMaterial, Object3D, type Points, type PointsMaterial, type Texture, Vector3,
} from 'three';
import type { Fact, FunctionName, PlayerView, UtilityCard } from '../../shared/types';
import { CARD_ICONS, CATEGORY_ICONS, ROLE_ICONS } from '../../shared/icons';
import { CARD_NAME, remainingMs, useNet } from '../net';
import { ROLE_LABEL } from '../labels';
import { setHover } from '../ui/hover';
import {
  clearTextureCache, COLORS, countTexture, deltaTexture, drawTimer, factFace, gridTexture, messageBack, messageFace, scoreTexture,
  shadowTexture, stampTexture, utilityBack, utilityFace,
} from './textures';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const CARD = { w: 1.26, h: 1.76 };
const FACT = { w: 1.5, h: 0.955 };

interface CardProps {
  id: string;
  w: number;
  h: number;
  front: Texture;
  back?: Texture;
  position: [number, number, number];
  faceUp?: boolean;
  scale?: number;
  glow?: string | null;
  /** 第一次出現時從這個位置（桌面座標）飛過來。 */
  from?: [number, number, number];
  /** 不畫桌面陰影（立起來的牌用）。 */
  noShadow?: boolean;
  /** 立起來面向玩家（0 平躺、1 立起），判斷時用來放大對手的消息。 */
  raise?: number;
  /** 結算時的螢光邊框顏色與浮在卡片上方的得分文字。 */
  result?: { color: string; text: string } | null;
  onClick?: () => void;
  children?: ReactNode;
}

/** 平躺在桌上的卡片；位置與翻面都用平滑插值移動到目標。 */
function Card({ w, h, front, back, position, faceUp = true, scale = 1, glow, from, noShadow, raise = 0, result, onClick, children }: CardProps) {
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const glowMat = useRef<MeshBasicMaterial>(null);
  const frameMat = useRef<MeshBasicMaterial>(null);
  const haloMat = useRef<MeshBasicMaterial>(null);
  const [hover, setHover] = useState(false);
  const target = useMemo(() => new Vector3(), []);
  const first = useRef(true);

  useFrame((state, dt) => {
    const g = outer.current;
    const i = inner.current;
    if (!g || !i) return;
    const still = reducedMotion();
    if (first.current && from && !still) {
      // 從牌庫、手牌或對手手牌的位置飛過來，一開始是蓋著的
      first.current = false;
      g.position.set(from[0], from[1], from[2]);
      g.scale.setScalar(scale * 0.55);
      i.rotation.x = Math.PI / 2;
      return;
    }
    const rx = faceUp ? -Math.PI / 2 + raise * 0.7 : Math.PI / 2;
    // 翻牌時先抬起再落下，翻到一半最高
    const left = Math.abs(rx - i.rotation.x);
    const arc = left > 0.03 && !still ? Math.sin((1 - Math.min(1, left / Math.PI)) * Math.PI) * 0.9 : 0;
    const lift = hover && onClick ? 0.22 : 0.02;
    target.set(position[0], position[1] + lift + raise * 0.55 + arc, position[2]);
    const k = still || first.current ? 1 : 1 - Math.exp(-dt * 7);
    const kr = still || first.current ? 1 : 1 - Math.exp(-dt * 4.5);
    first.current = false;
    g.position.lerp(target, k);
    const s = g.scale.x + (scale * (hover && onClick ? 1.06 : 1) - g.scale.x) * k;
    g.scale.setScalar(s);
    i.rotation.x += (rx - i.rotation.x) * kr;
    if (shadow.current) shadow.current.position.y = -g.position.y + 0.004;
    if (glowMat.current) glowMat.current.opacity = 0.45 + Math.sin(state.clock.elapsedTime * 4) * 0.2;
    if (frameMat.current || haloMat.current) {
      const pulse = 0.5 + Math.sin(state.clock.elapsedTime * 6) * 0.5;
      if (frameMat.current) frameMat.current.opacity = 0.85 + pulse * 0.15;
      if (haloMat.current) haloMat.current.opacity = 0.25 + pulse * 0.2;
    }
  });

  return (
    <group
      ref={outer}
      position={position}
      onPointerOver={(e) => {
        if (!onClick) return;
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = '';
      }}
      onClick={(e) => {
        if (!onClick) return;
        e.stopPropagation();
        onClick();
      }}
    >
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} visible={!noShadow}>
        <planeGeometry args={[w * 1.25, h * 1.2]} />
        <meshBasicMaterial map={shadowTexture()} transparent depthWrite={false} opacity={0.7} />
      </mesh>
      <group ref={inner} rotation={[faceUp ? -Math.PI / 2 : Math.PI / 2, 0, 0]}>
        {glow && (
          <mesh position={[0, 0, -0.004]}>
            <planeGeometry args={[w + 0.12, h + 0.12]} />
            <meshBasicMaterial ref={glowMat} color={glow} transparent opacity={0.5} depthWrite={false} blending={AdditiveBlending} />
          </mesh>
        )}
        {/* 結算螢光：內框實色＋外圈光暈（只有結算時才建立） */}
        {result && (
          <>
            <mesh position={[0, 0, -0.006]}>
              <planeGeometry args={[w + 0.5, h + 0.5]} />
              <meshBasicMaterial ref={haloMat} color={result.color} transparent opacity={0.3} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0, -0.005]}>
              <planeGeometry args={[w + 0.18, h + 0.18]} />
              <meshBasicMaterial ref={frameMat} color={result.color} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
            </mesh>
          </>
        )}
        <mesh>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial map={front} transparent toneMapped={false} />
        </mesh>
        {back && (
          <mesh rotation={[0, Math.PI, 0]} position={[0, 0, -0.002]}>
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial map={back} transparent toneMapped={false} />
          </mesh>
        )}
        {children}
      </group>
      {result && <DeltaPop text={result.text} color={result.color} position={[0, 0.45, -h / 2 - 0.3]} />}
    </group>
  );
}

/**
 * 結算時浮在卡片上方的 +1 / -1：彈出、放大再停住，永遠面向鏡頭。
 * 直接畫在 3D 場景裡（不用 HTML 疊層），不會被其他介面蓋掉。
 */
function DeltaPop({ text, color, position }: { text: string; color: string; position: [number, number, number] }) {
  const ref = useRef<Group>(null);
  const mat = useRef<MeshBasicMaterial>(null);
  const age = useRef(0);
  useFrame((_, dt) => {
    age.current += Math.min(dt, 1 / 30);
    const t = reducedMotion() ? 1 : Math.min(1, age.current / 1.2);
    const s = t < 0.4 ? 0.4 + 0.75 * (t / 0.4) : 1.15 - 0.15 * ((t - 0.4) / 0.6);
    if (ref.current) {
      ref.current.scale.setScalar(s);
      ref.current.position.y = -0.3 + 0.4 * Math.min(1, t / 0.4) + 0.1 * t;
    }
    if (mat.current) mat.current.opacity = Math.min(1, t / 0.3);
  });
  return (
    <Billboard position={position}>
      <group ref={ref}>
        <mesh renderOrder={10}>
          <planeGeometry args={[1.4, 0.875]} />
          <meshBasicMaterial ref={mat} map={deltaTexture(text, color)} transparent opacity={0} depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </Billboard>
  );
}

/**
 * 立體像素粒子：小方塊從卡片噴出、落在桌面彈跳，位置對齊格線，
 * 最後分段縮小消失（結算演出用）。
 */
function VoxelBurst({ origin, color, count = 48 }: { origin: [number, number, number]; color: string; count?: number }) {
  const ref = useRef<InstancedMesh>(null);
  const sim = useMemo(() => {
    const base = new Color(color);
    const light = base.clone().lerp(new Color('#ffffff'), 0.55);
    return {
      age: 0,
      parts: Array.from({ length: count }, (_, i) => {
        const a = Math.random() * Math.PI * 2;
        const r = 0.6 + Math.random() * 2.4;
        return {
          p: new Vector3((Math.random() - 0.5) * 1.2, 0.1, (Math.random() - 0.5) * 1.6),
          v: new Vector3(Math.cos(a) * r, 2.5 + Math.random() * 3.5, Math.sin(a) * r),
          spin: new Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
          size: Math.random() < 0.25 ? 1.8 : 1,
          color: i % 3 === 0 ? light : base,
        };
      }),
      dummy: new Object3D(),
    };
  }, [color, count]);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    sim.parts.forEach((q, i) => m.setColorAt(i, q.color));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [sim]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const m = ref.current;
    if (!m) return;
    sim.age += dt;
    const life = 1.8;
    m.visible = sim.age < life;
    if (!m.visible) return;
    const d = sim.dummy;
    sim.parts.forEach((q, i) => {
      q.v.y -= 9 * dt;
      q.p.addScaledVector(q.v, dt);
      if (q.p.y < 0.05) {
        q.p.y = 0.05;
        q.v.y *= -0.35;
        q.v.x *= 0.7;
        q.v.z *= 0.7;
      }
      d.position.set(Math.round(q.p.x / SNAP) * SNAP, Math.round(q.p.y / SNAP) * SNAP, Math.round(q.p.z / SNAP) * SNAP);
      d.rotation.set(q.spin.x * sim.age, q.spin.y * sim.age, q.spin.z * sim.age);
      const fade = sim.age > life - 0.5 ? Math.ceil(((life - sim.age) / 0.5) * 4) / 4 : 1;
      d.scale.setScalar(q.size * fade);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  if (reducedMotion()) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} position={origin}>
      <boxGeometry args={[0.09, 0.09, 0.09]} />
      <meshLambertMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/** 公開查證資訊時，一道掃描線由上往下掃過卡片（500 ms）。 */
function ScanLine({ w, h }: { w: number; h: number }) {
  const ref = useRef<Mesh>(null);
  const t = useRef(0);
  useFrame((_, dt) => {
    if (!ref.current) return;
    t.current += dt;
    const p = Math.min(1, t.current / 0.5);
    ref.current.position.y = h / 2 - p * h;
    (ref.current.material as MeshBasicMaterial).opacity = p >= 1 ? 0 : 0.9;
  });
  if (reducedMotion()) return null;
  return (
    <mesh ref={ref} position={[0, h / 2, 0.003]}>
      <planeGeometry args={[w, 0.07]} />
      <meshBasicMaterial color="#B6FF9E" transparent opacity={0.9} blending={AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

const SNAP = 0.07; // 像素格線：粒子位置對齊這個間距，呈現一格一格的像素感

/** 像素粒子爆發：方形點、位置對齊格線、透明度分段遞減（企畫書 14.6）。 */
function PixelBurst({ origin, color, count }: { origin: [number, number, number]; color: string; count: number }) {
  const ref = useRef<Points>(null);
  const sim = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2;
      const r = 0.8 + Math.random() * 2.2;
      return new Vector3(Math.cos(a) * r, 1.8 + Math.random() * 2.6, Math.sin(a) * r);
    });
    const raw = Array.from({ length: count }, () => new Vector3());
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    return { pos, vel, raw, geo, age: 0 };
  }, [count]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const pts = ref.current;
    if (!pts) return;
    sim.age += dt;
    const life = 0.9;
    pts.visible = sim.age < life;
    if (!pts.visible) return;
    sim.raw.forEach((p, i) => {
      p.addScaledVector(sim.vel[i], dt);
      sim.vel[i].y -= 7 * dt;
      sim.pos[i * 3] = Math.round(p.x / SNAP) * SNAP;
      sim.pos[i * 3 + 1] = Math.max(0, Math.round(p.y / SNAP) * SNAP);
      sim.pos[i * 3 + 2] = Math.round(p.z / SNAP) * SNAP;
    });
    sim.geo.attributes.position.needsUpdate = true;
    (pts.material as PointsMaterial).opacity = Math.ceil((1 - sim.age / life) * 4) / 4;
  });
  if (reducedMotion()) return null;
  return (
    <points ref={ref} position={origin} geometry={sim.geo}>
      <pointsMaterial color={color} size={7} sizeAttenuation={false} transparent depthWrite={false} />
    </points>
  );
}

/** 桌面上空慢慢落下的綠色資料像素，像代碼雨。 */
function PixelDust() {
  const ref = useRef<Points>(null);
  const N = 36;
  const sim = useMemo(() => {
    const raw = Array.from({ length: N }, () => new Vector3((Math.random() - 0.5) * 14, Math.random() * 3, (Math.random() - 0.5) * 9));
    const speed = raw.map(() => 0.1 + Math.random() * 0.25);
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const palette = [new Color('#00FF66'), new Color('#00C853'), new Color('#7CFFB0'), new Color('#2DE2E6')];
    raw.forEach((_, i) => palette[i % palette.length].toArray(col, i * 3));
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    return { raw, speed, pos, geo };
  }, []);
  useFrame((_, dt) => {
    if (reducedMotion()) return;
    sim.raw.forEach((p, i) => {
      p.y -= sim.speed[i] * dt * 2.2;
      if (p.y < 0) p.y = 3.2;
      sim.pos[i * 3] = Math.round(p.x / SNAP) * SNAP;
      sim.pos[i * 3 + 1] = Math.round(p.y / SNAP) * SNAP;
      sim.pos[i * 3 + 2] = Math.round(p.z / SNAP) * SNAP;
    });
    sim.geo.attributes.position.needsUpdate = true;
  });
  return (
    <points ref={ref} geometry={sim.geo}>
      <pointsMaterial vertexColors size={4} sizeAttenuation={false} transparent opacity={0.4} depthWrite={false} />
    </points>
  );
}

/**
 * 場地分成兩個半場（企畫書 14.4）：
 * 對手半場在遠端：對手的手牌（牌背扇形）、兩副牌庫、出牌位置，右側是查證資訊；
 * 我的半場在近端：出牌位置在中央，兩副牌庫在左右兩側。
 */
const POS = {
  oppHand: { z: -4.25, y: 0.55 },
  oppSlot: [0, 0, -2.45] as [number, number, number],
  oppDeckMsg: [-4.3, 0, -2.9] as [number, number, number],
  oppDeckUtil: [4.3, 0, -2.9] as [number, number, number],
  divider: -1.05,
  oppScore: [-2.3, 0.006, -2.75] as [number, number, number],
  myScore: [-2.3, 0.006, 0.5] as [number, number, number],
  mySlot: [0, 0, 0.35] as [number, number, number],
  myDeckMsg: [-4.3, 0, 0.45] as [number, number, number],
  myDeckUtil: [4.3, 0, 0.45] as [number, number, number],
  factX: 2.25,
  factZ0: -3.3,
  factGap: 0.95,
  factScale: 0.85,
  /** 手牌大約在畫面下緣時的世界座標，打出的牌從這裡飛到桌上。 */
  fromHand: [0, 3.2, 4.6] as [number, number, number],
};

const ZONES: Record<string, [number, number, number]> = {
  'my-hand': [0, 0.4, 1.95],
  'opp-message': [POS.oppSlot[0], 0.4, POS.oppSlot[2]],
  facts: [POS.factX, 0.3, -2.4],
  'my-message': [POS.mySlot[0], 0.3, POS.mySlot[2]],
  center: [0, 0.6, -1],
};

/** 結算演出的顏色：判斷正確螢光綠、判斷錯誤紅、不加不扣橙。 */
export const RESULT_COLORS = { good: '#22FF66', bad: '#FF2D55', even: '#FF9F1A' };
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : '±0');

function CameraRig() {
  const { camera, pointer } = useThree();
  const tmp = useMemo(() => new Vector3(), []);
  const look = useMemo(() => new Vector3(0, 0, -0.6), []);
  useFrame((_, dt) => {
    const still = reducedMotion();
    const px = still ? 0 : pointer.x * 0.3;
    const py = still ? 0 : pointer.y * 0.15;
    tmp.set(px, 9.2 + py, 7.4);
    const k = still ? 1 : 1 - Math.exp(-dt * 4);
    camera.position.lerp(tmp, k);
    camera.lookAt(look);
  });
  return null;
}

/** 效能偵測：網址加 ?perf 時，把 three.js 的狀態掛到 window.__r3f，方便在主控台量測。 */
const PERF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');
function PerfProbe() {
  useFrame((state) => {
    if (PERF) (window as unknown as { __r3f: unknown }).__r3f = state;
  });
  return null;
}

/** 窄螢幕時把整張桌面縮小，讓兩個半場都放得下。 */
function useTableScale() {
  const { size } = useThree();
  const aspect = size.width / Math.max(1, size.height);
  return Math.min(1, Math.max(0.42, aspect / 1.55));
}

/**
 * 卡片消失：分段變透明、縮小、往上飄，同時噴出像素方塊（用過的卡、上一回合的牌）。
 */
function Dissolve({
  texture, w, h, position, rotation, color,
}: {
  texture: Texture;
  w: number;
  h: number;
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
}) {
  const ref = useRef<Group>(null);
  const mat = useRef<MeshBasicMaterial>(null);
  const age = useRef(0);
  useFrame((_, rawDt) => {
    const g = ref.current;
    if (!g || !mat.current) return;
    age.current += Math.min(rawDt, 1 / 30);
    const t = Math.min(1, age.current / 0.6);
    mat.current.opacity = Math.ceil((1 - t) * 5) / 5;
    g.scale.setScalar(1 - t * 0.35);
    g.position.set(position[0], position[1] + t * 0.5, position[2]);
    g.visible = t < 1;
  });
  if (reducedMotion()) return null;
  return (
    <>
      <group ref={ref} position={position} rotation={rotation}>
        <mesh>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial ref={mat} map={texture} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      <VoxelBurst origin={position} color={color} count={18} />
    </>
  );
}

interface GhostItem {
  key: string;
  texture: Texture;
  w: number;
  h: number;
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
}

/** 追蹤上一次畫面上的物件；消失的物件變成 0.8 秒的消失動畫。 */
function useGhosts(items: GhostItem[], skip: (key: string) => boolean) {
  const prev = useRef<Map<string, GhostItem>>(new Map());
  const [ghosts, setGhosts] = useState<(GhostItem & { id: number })[]>([]);
  const idRef = useRef(1);
  const signature = items.map((i) => i.key).join('|');
  useEffect(() => {
    const now = new Map(items.map((i) => [i.key, i]));
    const gone = [...prev.current.values()].filter((i) => !now.has(i.key) && !skip(i.key));
    prev.current = now;
    if (!gone.length) return;
    const added = gone.map((g) => ({ ...g, id: idRef.current++ }));
    setGhosts((list) => [...list, ...added]);
    const t = setTimeout(() => setGhosts((list) => list.filter((g) => !added.includes(g))), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  // 位置會隨手牌重排而變，每次畫面更新都記下最新位置
  for (const i of items) prev.current.set(i.key, i);
  return ghosts;
}

/** 牌庫：一個方塊（頂面是牌背，側面是紙邊），高度隨張數變化；count 為 null 時代表張數不公開。 */
function DeckPile({ position, texture, edge, count }: { position: [number, number, number]; texture: Texture; edge: string; count: number | null }) {
  const s = 0.62;
  const height = count === null ? 0.16 : 0.03 + Math.min(count, 18) * 0.013;
  return (
    <group position={position}>
      <mesh position={[0, height / 2, 0]} rotation={[0, 0.04, 0]}>
        <boxGeometry args={[CARD.w * s, height, CARD.h * s]} />
        <meshBasicMaterial attach="material-0" color={edge} />
        <meshBasicMaterial attach="material-1" color={edge} />
        <meshBasicMaterial attach="material-2" map={texture} toneMapped={false} />
        <meshBasicMaterial attach="material-3" color={edge} />
        <meshBasicMaterial attach="material-4" color={edge} />
        <meshBasicMaterial attach="material-5" color={edge} />
      </mesh>
      {count !== null && (
        <mesh position={[0, 0.004, CARD.h * s * 0.5 + 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.5, 0.25]} />
          <meshBasicMaterial map={countTexture(count)} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/** 對手的手牌：遠端立起來的一排牌背；新抽的牌從對手牌庫飛進來。 */
function OppHand({ count }: { count: number }) {
  const spacing = 0.52;
  return (
    <group>
      {Array.from({ length: count }, (_, i) => {
        const d = i - (count - 1) / 2;
        return (
          <Card
            key={i}
            id={`opp-hand-${i}`}
            {...CARD}
            scale={0.5}
            front={messageBack('opponent')}
            position={[d * spacing, POS.oppHand.y + Math.abs(d) * -0.03, POS.oppHand.z]}
            raise={1.35}
            from={[POS.oppDeckMsg[0], 0.3, POS.oppDeckMsg[2]]}
            noShadow
          />
        );
      })}
    </group>
  );
}

/** 兩個半場：對手半場淡橘、我的半場淡藍，中間一條實線。 */
function Halves() {
  const top = -6.2;
  const bottom = 3.2;
  return (
    <group>
      <mesh position={[0, 0.001, (top + POS.divider) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[11, POS.divider - top]} />
        <meshBasicMaterial color="#2DE2E6" transparent opacity={0.07} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.001, (POS.divider + bottom) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[11, bottom - POS.divider]} />
        <meshBasicMaterial color="#00FF66" transparent opacity={0.07} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.003, POS.divider]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[11, 0.34]} />
        <meshBasicMaterial color="#00FF66" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.004, POS.divider]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[11, 0.06]} />
        <meshBasicMaterial color="#5CFF9D" />
      </mesh>
    </group>
  );
}

/** 倒數：放在分隔線左端，永遠面向鏡頭；每秒重畫一次圓環與秒數。 */
function TableTimer({ deadline, position }: { deadline: number | null; position: [number, number, number] }) {
  const mesh = useRef<Mesh>(null);
  const rig = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    return { canvas, tex, key: '' };
  }, []);
  const total = useRef(1);
  const lastDeadline = useRef<number | null>(null);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    if (deadline === null) {
      m.visible = false;
      return;
    }
    const left = remainingMs(deadline) / 1000;
    // 這一段計時剛開始時的剩餘秒數，當作圓環的滿格
    if (lastDeadline.current !== deadline) {
      lastDeadline.current = deadline;
      total.current = Math.max(1, left);
    }
    m.visible = true;
    const sec = Math.ceil(left);
    const p = Math.max(0, Math.min(1, left / total.current));
    const key = sec + ':' + Math.round(p * 60);
    if (key !== rig.key) {
      rig.key = key;
      drawTimer(rig.canvas, sec, p);
      rig.tex.needsUpdate = true;
    }
  });
  return (
    <Billboard position={position}>
      <mesh ref={mesh} visible={false}>
        <planeGeometry args={[1.5, 1.5]} />
        <meshBasicMaterial map={rig.tex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </Billboard>
  );
}

/** 桌面：一張重複的格線貼圖（取代每個像素都要計算的格線 shader）。 */
function Ground() {
  const tex = useMemo(() => {
    const t = gridTexture();
    t.repeat.set(24, 24);
    return t;
  }, []);
  return (
    <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[60, 60]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

/** 半場的比分牌：分數變動時彈跳一下。 */
function ScorePlate({ position, nickname, score, target, side }: { position: [number, number, number]; nickname: string; score: number; target: number; side: 'me' | 'opponent' }) {
  const ref = useRef<Group>(null);
  const prev = useRef(score);
  const age = useRef(1);
  if (prev.current !== score) {
    prev.current = score;
    age.current = 0;
  }
  useFrame((_, dt) => {
    if (!ref.current) return;
    age.current = Math.min(1, age.current + dt / 0.6);
    const t = age.current;
    ref.current.scale.setScalar(reducedMotion() ? 1 : 1 + 0.3 * (1 - t) * (1 - t));
  });
  return (
    <group position={position}>
      <group ref={ref}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2.3, 1.15]} />
          <meshBasicMaterial map={scoreTexture(nickname, score, target, side)} transparent toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

interface TableProps {
  view: PlayerView;
  onSelectMessage: (id: string) => void;
  onUseCard: (card: UtilityCard) => void;
  /** 點桌上的資訊卡：在判斷卡裡標示對應的資訊。 */
  onFactClick: (fact: Fact) => void;
  fontVersion: number;
}

function Table({ view, onFactClick }: TableProps) {
  const { freshFacts, bursts } = useNet();
  const scale = useTableScale();
  const shared = view.sharedInfo;
  const acting = view.phase === 'action' && !view.me.locked;
  const revealedPhase = shared !== null;

  // 結算演出：我對對手消息的判斷顯示在對手的卡上，對手對我的判斷顯示在我的卡上
  const last = view.history.at(-1);
  const resolved = view.phase === 'round_result' && last && last.round === view.round ? last : null;
  const resultOf = (judgeIsMe: boolean) => {
    const e = resolved?.entries.find((x) => (x.judge === view.you) === judgeIsMe);
    if (!e) return null;
    const color = e.final > 0 ? RESULT_COLORS.good : e.final < 0 ? RESULT_COLORS.bad : RESULT_COLORS.even;
    return { color, text: signed(e.final) };
  };
  const oppResult = resultOf(true);
  const myResult = resultOf(false);

  // 對手出的牌：先蓋著從對手手牌飛到桌上，雙方都選好後翻開
  const oppMsg = shared?.opponentMessage.message;
  const oppFront = oppMsg ? messageFace({ ...oppMsg, categoryIcon: CATEGORY_ICONS[oppMsg.category], owner: 'opponent' }) : messageBack('opponent');
  const showOpp = view.opponent.selected || Boolean(oppMsg);
  // 我出的牌：從手牌飛到桌上蓋著，揭示時和對手的牌一起翻開
  const myPlayed = view.me.playedMessage;
  const myFront = myPlayed ? messageFace({ ...myPlayed, categoryIcon: CATEGORY_ICONS[myPlayed.category], owner: 'me' }) : null;

  const revealed = shared?.opponentMessage.revealed ?? [];
  const factTex = (f: Fact) =>
    factFace({
      id: f.id,
      content: f.content,
      roleLabel: f.role ? ROLE_LABEL[f.role] : shared!.opponentMessage.message.topicTitle,
      roleIcon: f.icon ?? (f.role ? ROLE_ICONS[f.role] : 'search'),
      source: f.source_name,
    });
  const factPos = (i: number): [number, number, number] => [POS.factX, 0.004 * i, POS.factZ0 + i * POS.factGap];

  const flat: [number, number, number] = [-Math.PI / 2, 0, 0];
  const ghosts = useGhosts(
    [
      ...(showOpp ? [{ key: `opp-r${view.round}`, texture: revealedPhase ? oppFront : messageBack('opponent'), w: CARD.w, h: CARD.h, position: POS.oppSlot, rotation: flat, color: COLORS.opponent }] : []),
      ...(myFront ? [{ key: `my-r${view.round}`, texture: revealedPhase ? myFront : messageBack('me'), w: CARD.w * 0.9, h: CARD.h * 0.9, position: POS.mySlot, rotation: flat, color: COLORS.me }] : []),
      ...revealed.map((f, i) => ({ key: f.id, texture: factTex(f), w: FACT.w * POS.factScale, h: FACT.h * POS.factScale, position: factPos(i), rotation: flat, color: COLORS.verify })),
    ],
    () => false,
  );

  return (
    <group scale={scale}>
      <Halves />
      <TableTimer deadline={view.phase === 'duel' || view.phase === 'game_over' ? null : view.deadline} position={[-4.6, 0.75, POS.divider]} />
      <ScorePlate position={POS.oppScore} nickname={view.opponent.nickname} score={view.opponent.score} target={view.targetScore} side="opponent" />
      <ScorePlate position={POS.myScore} nickname={view.me.nickname} score={view.me.score} target={view.targetScore} side="me" />
      <DeckPile position={POS.oppDeckMsg} texture={messageBack('opponent')} edge="#0C6E73" count={view.opponent.messageDeckCount} />
      <DeckPile position={POS.oppDeckUtil} texture={utilityBack()} edge="#5B2D8A" count={null} />
      <DeckPile position={POS.myDeckMsg} texture={messageBack('me')} edge="#0A7A3A" count={view.me.messageDeckCount} />
      <DeckPile position={POS.myDeckUtil} texture={utilityBack()} edge="#5B2D8A" count={view.me.utilityDeckCount} />
      <OppHand count={view.opponent.messageHandCount} />

      {showOpp && (
        <Card
          key={`opp-r${view.round}`}
          id="opp-msg"
          {...CARD}
          front={oppFront}
          back={messageBack('opponent')}
          position={POS.oppSlot}
          faceUp={revealedPhase}
          from={[0, 1.2, POS.oppHand.z]}
          glow={acting ? COLORS.opponent : null}
          result={oppResult}
        >
          {view.me.choice && (view.me.locked || view.phase === 'round_result') && (
            <mesh position={[0.35, -0.55, 0.01]} rotation={[0, 0, -0.25]}>
              <planeGeometry args={[0.8, 0.8]} />
              <meshBasicMaterial map={stampTexture(view.me.choice)} transparent toneMapped={false} depthWrite={false} />
            </mesh>
          )}
        </Card>
      )}
      {myFront && (
        <Card
          key={`my-r${view.round}`}
          id="my-msg"
          {...CARD}
          scale={0.9}
          front={myFront}
          back={messageBack('me')}
          position={POS.mySlot}
          faceUp={revealedPhase}
          from={POS.fromHand}
          result={myResult}
        />
      )}

      {revealed.map((f, i) => (
        <Card
          key={f.id}
          id={f.id}
          {...FACT}
          scale={POS.factScale}
          front={factTex(f)}
          position={factPos(i)}
          from={[POS.oppSlot[0], 0.8, POS.oppSlot[2]]}
          onClick={() => onFactClick(f)}
        >
          {freshFacts.includes(f.id) && <ScanLine w={FACT.w} h={FACT.h} />}
        </Card>
      ))}

      {ghosts.map((g) => (
        <Dissolve key={g.id} texture={g.texture} w={g.w} h={g.h} position={g.position} rotation={g.rotation} color={g.color} />
      ))}
      {resolved && oppResult && <VoxelBurst key={`o${resolved.round}`} origin={POS.oppSlot} color={oppResult.color} />}
      {resolved && myResult && <VoxelBurst key={`m${resolved.round}`} origin={POS.mySlot} color={myResult.color} count={32} />}
      <PixelDust />
      {bursts
        .filter((b) => b.zone !== 'my-hand')
        .map((b) => (
          <PixelBurst key={b.id} origin={ZONES[b.zone]} color={b.color} count={b.count} />
        ))}
    </group>
  );
}

const HAND = { w: 0.5, h: 0.7, dist: 4 };

interface HandCardProps {
  front: Texture;
  x: number;
  y: number;
  z: number;
  tilt: number;
  glow: string | null;
  /** 新抽到的牌：從桌上牌庫（世界座標）飛進手牌；delay 秒後出發（發牌時錯開）。 */
  spawn: { from: Vector3; delay: number } | null;
  onClick?: () => void;
  onHover: (e: { clientX: number; clientY: number } | null) => void;
}

/** 第一視角手持的一張牌：指到時抬起、放大、轉正。 */
function HandCard({ front, x, y, z, tilt, glow, spawn, onClick, onHover }: HandCardProps) {
  const ref = useRef<Group>(null);
  const glowMat = useRef<MeshBasicMaterial>(null);
  const [hover, setHoverState] = useState(false);
  // 飛入的起點只在剛出現時決定；之後重新渲染時 spawn 會變成 null
  const spawnAt = useRef(spawn);
  const stage = useRef<'wait' | 'fly' | 'rest'>(spawn && !reducedMotion() ? 'wait' : 'rest');
  const age = useRef(0);
  const first = useRef(true);
  const hovered = useRef(false);
  const tmp = useMemo(() => new Vector3(), []);
  hovered.current = hover;
  // 卡片被打出而消失時，收掉它的說明框與滑鼠游標
  useEffect(
    () => () => {
      if (hovered.current) {
        setHover(null);
        document.body.style.cursor = '';
      }
    },
    [],
  );
  useFrame((state, rawDt) => {
    const g = ref.current;
    if (!g || !g.parent) return;
    const dt = Math.min(rawDt, 1 / 20);
    age.current += dt;
    if (stage.current === 'wait') {
      // 停在牌庫上方等出發；手牌群組每格都跟著鏡頭動，所以每格重算
      g.parent.updateMatrixWorld();
      g.position.copy(g.parent.worldToLocal(tmp.copy(spawnAt.current!.from)));
      g.scale.setScalar(0.55);
      g.visible = false;
      if (age.current >= spawnAt.current!.delay && age.current > 0.05) {
        stage.current = 'fly';
        g.visible = true;
      }
      return;
    }
    const k = reducedMotion() || (first.current && stage.current === 'rest') ? 1 : 1 - Math.exp(-dt * (stage.current === 'fly' ? 6 : 12));
    first.current = false;
    if (stage.current === 'fly' && g.position.distanceTo(tmp.set(x, y, z)) < 0.03) stage.current = 'rest';
    const ty = hover ? y + 0.3 : y;
    const tz = hover ? z + 0.2 : z;
    g.position.x += (x - g.position.x) * k;
    g.position.y += (ty - g.position.y) * k;
    g.position.z += (tz - g.position.z) * k;
    g.rotation.z += ((hover ? 0 : tilt) - g.rotation.z) * k;
    const s = hover ? 1.4 : 1;
    g.scale.setScalar(g.scale.x + (s - g.scale.x) * k);
    if (glowMat.current) glowMat.current.opacity = 0.5 + Math.sin(state.clock.elapsedTime * 4) * 0.2;
  });
  return (
    <group
      ref={ref}
      position={[x, y, z]}
      rotation={[0, 0, tilt]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHoverState(true);
        onHover(e.nativeEvent);
        if (onClick) document.body.style.cursor = 'pointer';
      }}
      onPointerMove={(e) => onHover(e.nativeEvent)}
      onPointerOut={() => {
        setHoverState(false);
        onHover(null);
        document.body.style.cursor = '';
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {glow && (
        <mesh position={[0, 0, -0.003]}>
          <planeGeometry args={[HAND.w + 0.06, HAND.h + 0.06]} />
          <meshBasicMaterial ref={glowMat} color={glow} transparent opacity={0.5} depthWrite={false} blending={AdditiveBlending} />
        </mesh>
      )}
      <mesh>
        <planeGeometry args={[HAND.w, HAND.h]} />
        <meshBasicMaterial map={front} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

/** 手牌：固定在鏡頭前、畫面下緣，呈扇形握在手上（第一視角）。 */
function HeldHand({ view, onSelectMessage, onUseCard }: Omit<TableProps, 'fontVersion'>) {
  const { camera, size } = useThree();
  const { bursts } = useNet();
  const scale = useTableScale();
  const ref = useRef<Group>(null);
  const known = useRef<Set<string> | null>(null);
  const selecting = view.phase === 'select_message' && !view.me.selected;
  const acting = view.phase === 'action' && !view.me.locked;

  const visH = 2 * Math.tan(((35 / 2) * Math.PI) / 180) * HAND.dist;
  const visW = visH * (size.width / Math.max(1, size.height));

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
    g.translateZ(-HAND.dist);
    g.translateY(-visH / 2 + HAND.h * 0.66);
  });

  const cards = [
    ...view.me.messageHand.map((m) => ({ key: m.id, kind: 'message' as const, m })),
    ...view.me.utilityHand.map((c) => ({ key: c.uid, kind: 'utility' as const, c })),
  ];
  const n = cards.length;
  const spacing = Math.min(HAND.w * 0.92, (Math.min(visW * 0.8, 5.2) - HAND.w) / Math.max(1, n - 1));
  const mid = (n - 1) / 2;

  // 新抽到的牌：從對應的牌庫飛進來；第一次進場時依序發牌
  const firstDeal = known.current === null;
  const newKeys = cards.filter((c) => !known.current?.has(c.key)).map((c) => c.key);
  useEffect(() => {
    known.current = new Set(cards.map((c) => c.key));
  });
  const deckWorld = (kind: 'message' | 'utility') => {
    const p = kind === 'message' ? POS.myDeckMsg : POS.myDeckUtil;
    return new Vector3(p[0] * scale, 0.3, p[2] * scale);
  };

  const layout = cards.map((card, i) => {
    const d = i - mid;
    return {
      card,
      x: d * spacing,
      y: -((d / Math.max(1, mid)) ** 2) * 0.1,
      z: i * 0.004,
      tilt: -(d / Math.max(1, mid)) * Math.min(0.28, 0.05 * mid),
    };
  });
  const faceOf = (card: (typeof cards)[number]) => {
    if (card.kind === 'message') {
      return { tex: messageFace({ ...card.m, categoryIcon: CATEGORY_ICONS[card.m.category], owner: 'me' }), color: COLORS.me };
    }
    const c = card.c;
    const status = view.me.cardStatus[c.uid] ?? { usable: false };
    const color = c.name === 'verify' ? COLORS.verify : c.name === 'direct_duel' ? COLORS.duel : COLORS.function;
    return {
      tex: utilityFace({ name: c.name, label: CARD_NAME[c.name].replace('卡', ''), icon: CARD_ICONS[c.name], color, dim: acting && !(acting && status.usable) }),
      color,
    };
  };

  // 用掉的實用卡在手上消失；打出的消息卡會飛到桌上，所以不做消失動畫
  const ghosts = useGhosts(
    layout.map((l) => {
      const f = faceOf(l.card);
      return { key: l.card.key, texture: f.tex, w: HAND.w, h: HAND.h, position: [l.x, l.y + 0.2, l.z + 0.1] as [number, number, number], rotation: [0, 0, l.tilt] as [number, number, number], color: f.color };
    }),
    (key) => key === view.me.playedMessage?.id,
  );

  return (
    <group ref={ref}>
      {layout.map((l) => {
        const { card } = l;
        const isNew = newKeys.includes(card.key);
        const spawn = isNew
          ? { from: deckWorld(card.kind), delay: firstDeal ? newKeys.indexOf(card.key) * 0.09 : newKeys.indexOf(card.key) * 0.15 }
          : null;
        const common = { x: l.x, y: l.y, z: l.z, tilt: l.tilt, spawn };
        const face = faceOf(card);
        if (card.kind === 'message') {
          const m = card.m;
          return (
            <HandCard
              key={card.key}
              {...common}
              front={face.tex}
              glow={selecting ? COLORS.me : null}
              onClick={selecting ? () => onSelectMessage(m.id) : undefined}
              onHover={(e) =>
                setHover(e ? { kind: 'message', message: m, selectable: selecting, x: e.clientX, y: e.clientY } : null)
              }
            />
          );
        }
        const c = card.c;
        const status = view.me.cardStatus[c.uid] ?? { usable: false };
        const usable = acting && status.usable;
        const shown = acting ? status : { usable: false, reason: '在「查證與判斷」階段才能使用' };
        return (
          <HandCard
            key={card.key}
            {...common}
            front={face.tex}
            glow={usable ? face.color : null}
            onClick={usable ? () => onUseCard(c) : undefined}
            onHover={(e) => setHover(e ? { kind: 'utility', name: c.name, status: shown, x: e.clientX, y: e.clientY } : null)}
          />
        );
      })}
      {ghosts.map((g) => (
        <Dissolve key={g.id} texture={g.texture} w={g.w} h={g.h} position={g.position} rotation={g.rotation} color={g.color} />
      ))}
      {bursts
        .filter((b) => b.zone === 'my-hand')
        .map((b) => (
          <PixelBurst key={b.id} origin={[0, 0.3, 0.3]} color={b.color} count={b.count} />
        ))}
    </group>
  );
}

export function hasWebGL(): boolean {
  // 網址加上 ?nowebgl=1 可強制使用純 HTML 版（測試用，或給效能較弱的電腦）
  if (new URLSearchParams(location.search).has('nowebgl')) return false;
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function Scene(props: Omit<TableProps, 'fontVersion'>) {
  const [fontVersion, setFontVersion] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    const redraw = () => {
      clearTextureCache();
      setFontVersion((v) => v + 1);
    };
    fonts.addEventListener('loadingdone', redraw);
    const v = props.view;
    const text = [
      ...v.me.messageHand.map((m) => m.statement),
      v.sharedInfo?.opponentMessage.message.statement ?? '',
      ...(v.sharedInfo?.opponentMessage.revealed.map((f) => f.content + f.source_name) ?? []),
      '真假對決對手的消息我的手牌來源查證網路風傳事先調查加倍小心謹慎重新再來保守直接對決',
    ].join('');
    for (const w of [500, 700, 900]) fonts.load(`${w} 32px "Noto Sans TC"`, text).catch(() => {});
    fonts.load('700 32px "Roboto Mono"', '+-0123456789').catch(() => {});
    return () => fonts.removeEventListener('loadingdone', redraw);
  }, [props.view]);

  // 解析度依實際流暢度自動調整：跑不動時降到 1，順暢時回到螢幕的縮放比（最高 1.5）
  const maxDpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 1.5);
  const [dpr, setDpr] = useState(Math.min(maxDpr, 1.25));

  return (
    <Canvas
      className="scene-canvas"
      dpr={dpr}
      camera={{ fov: 35, position: [0, 8.8, 7.6], near: 0.1, far: 60 }}
      gl={{ antialias: true }}
      aria-hidden
    >
      <PerformanceMonitor
        flipflops={4}
        onChange={({ factor }) => setDpr(Math.round((1 + (maxDpr - 1) * factor) * 20) / 20)}
        onFallback={() => setDpr(1)}
      />
      <color attach="background" args={[COLORS.bg]} />
      <fog attach="fog" args={[COLORS.bg, 14, 30]} />
      <hemisphereLight args={['#ccffdd', '#003311', 1.2]} />
      <directionalLight position={[3, 8, 4]} intensity={0.7} />
      <CameraRig />
      <PerfProbe />
      <Ground />
      <Table {...props} fontVersion={fontVersion} />
      <HeldHand {...props} key={fontVersion} />
    </Canvas>
  );
}
