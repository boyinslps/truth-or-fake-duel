// 直接對決的資訊科技是非題（20 題）。題號接在 duels.ts 的 40 題後面。
import type { DuelQuestion, Source } from '../shared/types';
import { S } from './sources';

function q(n: number, statement: string, answer: boolean, difficulty: 1 | 2, explanation: string, source: Source): DuelQuestion {
  return { id: `duel_${String(n).padStart(3, '0')}`, statement, answer, category: '資訊科技', difficulty, explanation, sources: [source] };
}

export const DUELS_INFO: DuelQuestion[] = [
  q(41, '電腦的 CPU 負責運算。', true, 1, 'CPU 是中央處理器，負責執行運算和指令。', S.BRIT),
  q(42, '1 個位元組（byte）等於 8 個位元。', true, 2, '1 byte 等於 8 bit。', S.BRIT),
  q(43, '網址以 https 開頭，網站就一定可信。', false, 2, 'https 只表示連線有加密，詐騙網站也可以有。', S.CERT),
  q(44, '二進位只用 0 和 1 兩個數字。', true, 1, '二進位每一位只有 0 或 1。', S.BRIT),
  q(45, '按 Ctrl+C 可以複製選取的內容。', true, 1, 'Ctrl+C 是複製，Ctrl+V 是貼上。', S.MS),
  q(46, '網際網路和 Wi-Fi 是同一個東西。', false, 1, 'Wi-Fi 是無線連線的方式，網際網路是全世界連在一起的網路。', S.BRIT),
  q(47, '密碼越長，通常越難被猜中。', true, 1, '長度是密碼強度很重要的一部分。', S.NIST),
  q(48, '簡訊裡的陌生連結都可以放心點。', false, 1, '詐騙簡訊常用連結騙你輸入資料，陌生連結不要點。', S.T165),
  q(49, '網路上的圖片都可以免費隨便使用。', false, 1, '多數圖片仍有著作權，使用要先確認授權。', S.IPO),
  q(50, '電子郵件的寄件人名稱可以偽造。', true, 2, '顯示的名稱可以被偽造，要小心不明來源的信。', S.CERT),
  q(51, '電腦關機後，記憶體（RAM）裡的資料會消失。', true, 2, 'RAM 只暫放運算中的資料，斷電就清空。', S.BRIT),
  q(52, '螢幕截圖也可能洩漏個人資料。', true, 1, '截圖裡的姓名、帳號或住址被看到，就可能洩漏個資。', S.T165),
  q(53, 'HTML 是用來做網頁的標記語言。', true, 2, 'HTML 用標籤描述網頁的內容和結構。', S.W3C),
  q(54, '雲端硬碟是把檔案放在遠端的電腦裡。', true, 1, '雲端就是把檔案存在別人機房的伺服器上，用網路取用。', S.BRIT),
  q(55, '手機不會中毒，只有電腦會。', false, 1, '手機也可能被惡意程式感染，所以不要亂裝來路不明的 App。', S.CERT),
  q(56, '掃了 QR Code 就一定安全。', false, 1, 'QR Code 可以連到詐騙網站，掃之前要確認來源。', S.T165),
  q(57, '同一組密碼用在所有網站最安全。', false, 1, '一個網站外洩，其他帳號也會跟著危險。', S.CERT),
  q(58, '世界上第一個網站在 1991 年公開上線。', true, 2, 'Tim Berners-Lee 在 CERN 建立的第一個網站，於 1991 年向外公開。', S.CERN),
  q(59, 'AI 給的答案有時會是錯的。', true, 1, '生成式 AI 可能編出看起來合理的錯誤內容，要查證。', S.NIST),
  q(60, '1 GB 比 1 MB 大。', true, 1, '1 GB 約等於 1000 MB（或 1024 MB）。', S.BRIT),
];
