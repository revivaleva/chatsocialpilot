/**
 * プリセットID 16のevalステップのチェックロジックを正確に修正するスクリプト
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset } from '../src/services/presets';

async function main() {
  initDb({ wal: true });
  
  const preset = getPreset(16);
  if (!preset) {
    console.error('プリセットID 16が見つかりません');
    process.exit(1);
  }
  
  const steps = JSON.parse(preset.steps_json || '[]');
  let updated = false;
  
  // evalステップを探して修正
  for (const step of steps) {
    if (step.type === 'eval' && step.code && step.code.includes('auth_token')) {
      // 文字列置換で直接修正
      const newCode = step.code.replace(
        "if (!authToken || authToken.trim() === '' || authToken === '{{auth_token}}')",
        "if (!authToken || authToken.trim() === '')"
      ).replace(
        "if (!ct0 || ct0.trim() === '' || ct0 === '{{ct0}}')",
        "if (!ct0 || ct0.trim() === '')"
      );
      
      if (newCode !== step.code) {
        step.code = newCode;
        updated = true;
        console.log('✅ プリセットID 16のコードを更新しました');
      }
    }
  }
  
  if (updated) {
    updatePreset(16, preset.name, preset.description, JSON.stringify(steps));
    console.log('✅ プリセットID 16を更新しました');
  } else {
    console.log('⚠️ プリセットID 16は更新されませんでした（既に修正済みの可能性があります）');
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

