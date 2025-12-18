import * as PresetService from '../src/services/presets.js';
import { initDb } from '../src/drivers/db.js';
import fs from 'node:fs';
import path from 'node:path';

// データベースを初期化
initDb();

// プリセットJSONファイルを読み込む
const presetPath = path.resolve('presets/x-post-with-local-media.json');
const presetData = JSON.parse(fs.readFileSync(presetPath, 'utf-8'));

// 既存のプリセットを検索（名前で検索）
const existingPresets = PresetService.listPresets();
const existingPreset = existingPresets.find((p: any) => p.name === presetData.name);

if (!existingPreset) {
  console.error(`✗ プリセット「${presetData.name}」が見つかりません`);
  console.log('新規登録します...');
  
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
} else {
  // 既存のプリセットを更新
  const result = PresetService.updatePreset(
    existingPreset.id,
    presetData.name,
    presetData.description,
    JSON.stringify(presetData.steps),
    0 // use_post_library = 0
  );
  
  console.log(`✓ プリセット更新完了`);
  console.log(`  ID: ${existingPreset.id}`);
  console.log(`  名前: ${presetData.name}`);
  console.log(`  説明: ${presetData.description}`);
  console.log(`  ステップ数: ${presetData.steps.length}`);
}
