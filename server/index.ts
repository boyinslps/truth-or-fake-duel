// 啟動點：先驗證題庫，通過才開伺服器。
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadContent, validateContent } from './content';
import { ICON_NAMES } from '../shared/icons';
import { createApp, lanUrls } from './app';

const here = dirname(fileURLToPath(import.meta.url));
const portArg = process.argv.indexOf('--port');
const parsed = Number(portArg > 0 ? process.argv[portArg + 1] : process.env.PORT);
const port = Number.isInteger(parsed) && parsed > 0 ? parsed : 3000;

// --config 或環境變數 ZJ_CONFIG 可指定另一份設定檔（例如課堂用較長的倒數）。
const configArg = process.argv.indexOf('--config');
const configPath = configArg > 0 ? process.argv[configArg + 1] : process.env.ZJ_CONFIG;
const content = loadContent(configPath || undefined);
if (configPath) console.log(`使用設定檔：${configPath}`);
const errors = validateContent(content, new Set(ICON_NAMES));
if (errors.length) {
  console.error(`題庫驗證失敗，共 ${errors.length} 項：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

// --data 或環境變數 ZJ_DATA 可指定帳號資料檔的位置（預設在專案的 data 資料夾）。
const dataArg = process.argv.indexOf('--data');
const dataFile = (dataArg > 0 ? process.argv[dataArg + 1] : process.env.ZJ_DATA) || join(here, '..', 'data', 'players.json');

const app = createApp({ content, staticDir: join(here, '..', 'dist'), dataFile });
const actual = await app.listen(port);
console.log(`真假對決伺服器已啟動：http://localhost:${actual}`);
console.log(`題庫：${content.messages.length} 張消息卡、${content.duels.length} 題直接對決題`);
console.log(`帳號資料：${dataFile}`);
const urls = lanUrls(actual);
console.log('');
console.log(urls.length ? '學生在瀏覽器輸入下面其中一個網址：' : '找不到區域網路位址，請確認這台電腦有連上網路。');
for (const u of urls) console.log(`  ${u}`);
console.log(`老師頁：http://localhost:${actual}/teacher`);
console.log('');
console.log('上課結束按 Ctrl+C 關閉伺服器。');

// 關閉前把帳號資料寫進檔案
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.store.flush();
    process.exit(0);
  });
}
