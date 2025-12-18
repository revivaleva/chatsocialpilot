import * as PresetService from '../src/services/presets.js';
import { initDb } from '../src/drivers/db.js';
import fs from 'node:fs';
import path from 'node:path';

// データベースを初期化
initDb();

// プリセットJSONファイルを読み込む
const presetPath = path.resolve('presets/x-post-with-local-media.json');
const presetData = JSON.parse(fs.readFileSync(presetPath, 'utf-8'));

// プリセットを登録
const result = PresetService.createPreset(
  presetData.name,
  presetData.description,
  JSON.stringify(presetData.steps)
);

console.log(`✓ プリセット登録完了`);
console.log(`  ID: ${result.id}`);
console.log(`  名前: ${presetData.name}`);
console.log(`  説明: ${presetData.description}`);
console.log(`  ステップ数: ${presetData.steps.length}`);
