/**
 * プリセットID 16と17が正しく修正されているか確認するスクリプト
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset } from '../src/services/presets';

async function main() {
  initDb({ wal: true });
  
  for (const presetId of [16, 17]) {
    const preset = getPreset(presetId);
    if (!preset) {
      console.log(`⚠️ Preset ID ${presetId} not found`);
      continue;
    }
    
    const steps = JSON.parse(preset.steps_json || '[]');
    console.log(`\nPreset ID ${presetId}: ${preset.name}`);
    
    // evalステップを探して確認
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'eval' && step.code && step.code.includes('auth_token')) {
        const lines = step.code.split('\n');
        const checkLineIndex = lines.findIndex(l => l.includes('if') && l.includes('authToken'));
        if (checkLineIndex >= 0) {
          const checkLine = lines[checkLineIndex].trim();
          console.log(`  Step ${i + 1} check line: ${checkLine}`);
          
          // 問題のあるパターンをチェック
          if (checkLine.includes("authToken === '{{auth_token}}'") || 
              checkLine.includes('authToken === "{{auth_token}}"')) {
            console.log(`    ❌ 問題: テンプレート変数との比較が残っています`);
          } else if (checkLine.includes("authToken === '") && /authToken === ['"][a-f0-9]{40,}/.test(checkLine)) {
            console.log(`    ❌ 問題: 置換後の値との比較が残っています`);
          } else if (checkLine.includes("if (!authToken || authToken.trim() === '')")) {
            console.log(`    ✅ 正しく修正されています`);
          } else {
            console.log(`    ⚠️ 予期しない形式: ${checkLine}`);
          }
        }
      }
    }
  }
  
  console.log('\n✅ 確認完了');
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

