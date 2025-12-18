/**
 * プリセットID 31 (Threads投稿メディア保存) を更新
 * 
 * 実行方法:
 *   npx tsx scripts/update-preset-31-threads-download-media.ts
 */

import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset } from '../src/services/presets';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initDb({ wal: true });

const presetId = 31;
const presetFile = path.join(__dirname, '../presets/threads-download-media.json');

// プリセットファイルを読み込む
const presetData = JSON.parse(fs.readFileSync(presetFile, 'utf-8'));

// DBから現在のプリセットを取得
const existing = getPreset(presetId);

if (!existing) {
  console.error(`プリセット ID ${presetId} が見つかりません`);
  process.exit(1);
}

console.log(`現在のプリセット: ${existing.name}`);
console.log(`更新するプリセット: ${presetData.name}`);

// プリセットを更新
updatePreset(
  presetId,
  presetData.name,
  presetData.description || '',
  JSON.stringify(presetData.steps)
);

console.log(`✅ プリセット ID ${presetId} を更新しました`);
console.log(`   名前: ${presetData.name}`);
console.log(`   ステップ数: ${presetData.steps.length}`);

