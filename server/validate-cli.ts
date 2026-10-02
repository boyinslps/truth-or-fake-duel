// npm run validate：檢查題庫與設定（企畫書 11.6）。
import { loadContent, validateContent } from './content';
import { ICON_NAMES } from '../shared/icons';

const content = loadContent();
const errors = validateContent(content, new Set(ICON_NAMES));
if (errors.length) {
  console.error(`題庫驗證失敗，共 ${errors.length} 項：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`題庫驗證通過：${content.messages.length} 張消息卡、${content.duels.length} 題直接對決題。`);
