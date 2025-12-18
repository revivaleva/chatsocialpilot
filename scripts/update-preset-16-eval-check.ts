/**
 * プリセットID 16のevalステップのチェックロジックを修正するスクリプト
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
  
  // evalステップを探して修正
  for (const step of steps) {
    if (step.type === 'eval' && step.code && step.code.includes('auth_token')) {
      // チェックロジックを修正
      step.code = step.code.replace(
        /if \(!authToken \|\| authToken === '\{\{auth_token\}\}' \|\| authToken\.trim\(\) === ''\)/,
        "if (!authToken || authToken.trim() === '' || authToken === '{{auth_token}}')"
      );
      step.code = step.code.replace(
        /if \(!ct0 \|\| ct0 === '\{\{ct0\}\}' \|\| ct0\.trim\(\) === ''\)/,
        "if (!ct0 || ct0.trim() === '' || ct0 === '{{ct0}}')"
      );
    }
  }
  
  const result = updatePreset(16, preset.name, preset.description, JSON.stringify(steps));
  console.log('✅ プリセットID 16を更新しました');
  console.log(`   ステップ数: ${steps.length}`);
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

