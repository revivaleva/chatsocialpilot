/**
 * プリセットID 31 (Threads投稿メディア保存) を更新 - forステップを削除して簡素化
 * 
 * 実行方法:
 *   npx tsx scripts/update-preset-31-simplify-for.ts
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

console.log('現在のステップ数:', existing.steps_json ? JSON.parse(existing.steps_json).length : 0);
console.log('新しいステップ数:', presetData.steps.length);

// プリセットを更新
const updated = updatePreset(
  presetId,
  presetData.name,
  presetData.description,
  JSON.stringify(presetData.steps)
);

if (updated) {
  console.log('✅ プリセットが更新されました');
  console.log('ステップ:', JSON.stringify(presetData.steps, null, 2));
} else {
  console.error('❌ プリセットの更新に失敗しました');
  process.exit(1);
}
