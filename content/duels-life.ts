// 直接對決的學生生活是非題（20 題，全部簡單）。題號接在 duels-info.ts 後面。
import type { DuelQuestion, Source } from '../shared/types';
import { S } from './sources';

function q(n: number, statement: string, answer: boolean, category: string, explanation: string, source: Source): DuelQuestion {
  return { id: `duel_${String(n).padStart(3, '0')}`, statement, answer, category, difficulty: 1, explanation, sources: [source] };
}

export const DUELS_LIFE: DuelQuestion[] = [
  q(61, '每天刷牙可以減少蛀牙。', true, '日常生活', '刷牙能把牙菌斑刷掉。', S.HPA),
  q(62, '打雷時應該待在室內。', true, '日常生活', '室內比空曠的地方安全。', S.CWA),
  q(63, '洗手要用肥皂搓一搓。', true, '日常生活', '用肥皂搓洗，才能洗掉細菌。', S.CDC),
  q(64, '喝白開水比喝含糖飲料健康。', true, '日常生活', '含糖飲料很多糖，天天喝不好。', S.HPA),
  q(65, '邊走路邊看手機很安全。', false, '日常生活', '看手機會沒注意到車子和障礙物，很危險。', S.MOE),
  q(66, '陰天也可能被紫外線曬傷。', true, '日常生活', '紫外線可以穿過雲層。', S.HPA),
  q(67, '每天睡越少，越有精神。', false, '日常生活', '睡不夠，白天會沒精神、不專心。', S.HPA),
  q(68, '寶特瓶可以資源回收。', true, '日常生活', '洗乾淨的寶特瓶可以變成新的東西。', S.ENV),
  q(69, '不認識的人給的零食可以直接吃。', false, '日常生活', '不要拿陌生人給的東西，也不要吃。', S.NPA),
  q(70, '騎腳踏車應該戴安全帽。', true, '日常生活', '安全帽能保護頭部。', S.MOTC),
  q(71, '蚊子只會在髒水裡生小孩。', false, '日常生活', '乾淨的積水也會長蚊子。', S.CDC),
  q(72, '電線破皮了，可以自己用手去碰。', false, '日常生活', '破皮的電線可能觸電，要請大人處理。', S.MOEA),
  q(73, '在網路上留言，也要有禮貌。', true, '網路資訊', '螢幕後面也是真的人，不要說傷人的話。', S.MOE),
  q(74, '看電視離螢幕越近越好。', false, '日常生活', '太近眼睛會累，要保持距離。', S.HPA),
  q(75, '把垃圾丟進垃圾桶是好習慣。', true, '日常生活', '亂丟垃圾會弄髒環境。', S.ENV),
  q(76, '打電動可以一直玩，不用休息。', false, '日常生活', '玩太久眼睛和身體都會累。', S.HPA),
  q(77, '遇到危險，可以大聲求救。', true, '日常生活', '大聲求救能讓旁邊的人知道你需要幫忙。', S.NPA),
  q(78, '太陽很大的時候，要多補充水分。', true, '日常生活', '天氣熱會流汗，要多喝水。', S.HPA),
  q(79, '不吃早餐，一定會變聰明。', false, '日常生活', '早餐是上午的能量，沒吃比較沒精神。', S.HPA),
  q(80, '借同學的東西，要先問過他。', true, '日常生活', '沒問就拿別人的東西，是不禮貌的。', S.MOE),
];
