#!/usr/bin/env node
/**
 * プリセットID 28をプリセットファイルから更新するスクリプト
 * データベースのプリセットにresult_varが含まれていない場合に使用
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, run, query } from '../src/drivers/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const presetFile = path.resolve(__dirname, '../presets/threads-search-example.json');
const presetId = 28;

async function main() {
  try {
    // データベースを初期化
    initDb();
    // プリセットファイルを読み込む
    const presetContent = fs.readFileSync(presetFile, 'utf-8');
    const preset = JSON.parse(presetContent);
    
    // データベースの現在のプリセットを確認
    const currentPreset = query('SELECT id, name, description, steps_json FROM presets WHERE id = ?', [presetId])[0] as any;
    
    if (!currentPreset) {
      console.error(`プリセットID ${presetId} が見つかりません`);
      process.exit(1);
    }
    
    console.log('現在のプリセット:', {
      id: currentPreset.id,
      name: currentPreset.name,
      description: currentPreset.description,
      stepsCount: JSON.parse(currentPreset.steps_json || '[]').length
    });
    
    // プリセットファイルの内容を確認
    const stepsJson = JSON.stringify(preset.steps || preset);
    const steps = preset.steps || (Array.isArray(preset) ? preset : []);
    
    // result_varが含まれているか確認
    const hasResultVar = steps.some((s: any) => {
      if (s.type === 'for' && Array.isArray(s.steps)) {
        return s.steps.some((inner: any) => inner.result_var);
      }
      return s.result_var;
    });
    
    console.log('プリセットファイルの内容:', {
      name: preset.name || 'N/A',
      description: preset.description || 'N/A',
      stepsCount: steps.length,
      hasResultVar
    });
    
    if (!hasResultVar) {
      console.error('プリセットファイルにresult_varが含まれていません');
      process.exit(1);
    }
    
    // データベースを更新
    const now = Date.now();
    run(
      'UPDATE presets SET name=?, description=?, steps_json=?, updated_at=? WHERE id=?',
      [
        preset.name || currentPreset.name,
        preset.description || currentPreset.description || '',
        stepsJson,
        now,
        presetId
      ]
    );
    
    console.log(`✅ プリセットID ${presetId} を更新しました`);
    console.log('更新内容:', {
      name: preset.name || currentPreset.name,
      description: preset.description || currentPreset.description || '',
      stepsCount: steps.length,
      hasResultVar: true
    });
    
  } catch (error: any) {
    console.error('エラー:', error.message);
    process.exit(1);
  }
}

main();

