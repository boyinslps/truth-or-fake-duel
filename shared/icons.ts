// 統一的圖示庫（企畫書 14.3）：只收錄遊戲用得到的 Lucide 圖示，前端 DOM 與卡面貼圖共用同一份資料。
import {
  Atom, Award, Bird, Bug, Camera, ChevronsUp, Circle, CloudSun, Crown, Droplet, Eye, Fish, FlaskConical, Globe, House,
  Image, Info, Landmark, Layers, Leaf, ListOrdered, LogOut, Megaphone, MessageSquareText, Moon, Mountain, Newspaper,
  Orbit, PawPrint, Pause, Pencil, Plus, RefreshCw, Ruler, ScanSearch, Search, Shield, Snowflake, Sun, Target,
  Thermometer, Timer, Trophy, Wifi, X, Zap,
} from 'lucide';

export type IconNode = [tag: string, attrs: Record<string, string | number>][];

export const ICONS: Record<string, IconNode> = {
  atom: Atom, award: Award, bird: Bird, bug: Bug, camera: Camera, 'chevrons-up': ChevronsUp, circle: Circle,
  'cloud-sun': CloudSun, crown: Crown, droplet: Droplet, eye: Eye, fish: Fish, 'flask-conical': FlaskConical,
  globe: Globe, house: House, image: Image, info: Info, landmark: Landmark, layers: Layers, leaf: Leaf,
  'list-ordered': ListOrdered, 'log-out': LogOut, megaphone: Megaphone, 'message-square-text': MessageSquareText,
  moon: Moon, mountain: Mountain, newspaper: Newspaper, orbit: Orbit, 'paw-print': PawPrint, pause: Pause,
  pencil: Pencil, plus: Plus, 'refresh-cw': RefreshCw, ruler: Ruler, 'scan-search': ScanSearch, search: Search,
  shield: Shield, snowflake: Snowflake, sun: Sun, target: Target, thermometer: Thermometer, timer: Timer,
  trophy: Trophy, wifi: Wifi, x: X, zap: Zap,
} as unknown as Record<string, IconNode>;

export const ICON_NAMES = Object.keys(ICONS);

export const CARD_ICONS = {
  message: 'message-square-text',
  verify: 'search',
  viral_spread: 'megaphone',
  investigate: 'eye',
  double: 'chevrons-up',
  careful: 'scan-search',
  reroll: 'refresh-cw',
  conservative: 'shield',
  direct_duel: 'zap',
} as const;

export const ROLE_ICONS = { direct: 'target', indirect: 'layers', context: 'info', extra: 'plus' } as const;

export const CATEGORY_ICONS: Record<string, string> = {
  自然科學: 'atom',
  地球與天文: 'orbit',
  地理: 'mountain',
  歷史常識: 'landmark',
  日常生活: 'house',
  網路資訊: 'wifi',
};

export const CHOICE_ICONS = { true: 'circle', false: 'x', hold: 'pause' } as const;
