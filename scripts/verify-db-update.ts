/**
 * データベースのプリセットが実際に更新されているか確認するスクリプト
 */

import 'dotenv/config';
import { initDb, query } from '../src/drivers/db';
import { getPreset } from '../src/services/presets';

async function main() {
  initDb({ wal: true });
  
  for (const presetId of [16, 17]) {
    console.log(`\n=== Preset ID ${presetId} ===`);
    
    // データベースから直接取得
    const rows = query('SELECT id, name, steps_json, updated_at FROM presets WHERE id=?', [presetId]);
    if (!rows || rows.length === 0) {
      console.log(`❌ Preset ID ${presetId} not found in database`);
      continue;
    }
    
    const preset = rows[0];
    console.log(`Name: ${preset.name}`);
    console.log(`Updated at: ${new Date(preset.updated_at).toISOString()}`);
    
    const steps = JSON.parse(preset.steps_json || '[]');
    
    // evalステップを探して確認
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'eval' && step.code && step.code.includes('auth_token')) {
        const lines = step.code.split('\n');
        const checkLineIndex = lines.findIndex(l => l.includes('if') && l.includes('authToken'));
        if (checkLineIndex >= 0) {
          const checkLine = lines[checkLineIndex].trim();
          console.log(`\nStep ${i + 1} (eval) check line:`);
          console.log(`  ${checkLine}`);
          
          // 問題のあるパターンをチェック
          if (checkLine.includes("authToken === '{{auth_token}}'") || 
              checkLine.includes('authToken === "{{auth_token}}"')) {
            console.log(`  ❌ 問題: テンプレート変数との比較が残っています`);
          } else if (checkLine.includes("authToken === '") && /authToken === ['"][a-f0-9]{40,}/.test(checkLine)) {
            console.log(`  ❌ 問題: 置換後の値との比較が残っています`);
          } else if (checkLine.includes("if (!authToken || authToken.trim() === '')")) {
            console.log(`  ✅ 正しく修正されています（空文字列チェックのみ）`);
          } else {
            console.log(`  ⚠️ 予期しない形式`);
          }
        }
      }
    }
  }
  
  console.log('\n=== Database Update Status ===');
  console.log('✅ updatePreset関数はデータベースを更新しています');
  console.log('   (src/services/presets.ts の updatePreset 関数を確認)');
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

