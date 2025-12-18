import * as PresetService from '../src/services/presets.js';
import { initDb } from '../src/drivers/db.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  // DBを初期化
  initDb({ wal: true });
  
  const presetPath = path.resolve('presets', 'threads-search-example.json');
  
  if (!fs.existsSync(presetPath)) {
    console.error(`プリセットファイルが見つかりません: ${presetPath}`);
    process.exit(1);
  }
  
  const presetData = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
  
  const name = presetData.name || 'Threads検索・投稿取得';
  const description = presetData.description || '';
  const stepsJson = JSON.stringify(presetData.steps || []);
  
  try {
    // 既存のプリセットを検索（名前で）
    const allPresets = PresetService.listPresets();
    const existing = Array.isArray(allPresets) ? allPresets.find((p: any) => p.name === name) : null;
    
    if (existing) {
      // 既存のプリセットを更新
      PresetService.updatePreset(existing.id, name, description, stepsJson);
      console.log(`プリセットを更新しました:`);
      console.log(`  ID: ${existing.id}`);
      console.log(`  名前: ${name}`);
      console.log(`  説明: ${description}`);
      console.log(`  ステップ数: ${(presetData.steps || []).length}`);
    } else {
      // 新規作成
      const result = PresetService.createPreset(name, description, stepsJson);
      console.log(`プリセットを登録しました:`);
      console.log(`  ID: ${result.id}`);
      console.log(`  名前: ${name}`);
      console.log(`  説明: ${description}`);
      console.log(`  ステップ数: ${(presetData.steps || []).length}`);
    }
  } catch (e: any) {
    console.error(`プリセット登録/更新に失敗しました: ${String(e?.message || e)}`);
    process.exit(1);
  }
}

main();


