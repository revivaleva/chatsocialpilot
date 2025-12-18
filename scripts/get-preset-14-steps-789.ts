import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset } from '../src/services/presets';

initDb({ wal: true });
const preset = getPreset(14);
if (!preset) {
  console.error('プリセットが見つかりません');
  process.exit(1);
}
const steps = JSON.parse(preset.steps_json || '[]');

console.log('ID14のステップ7, 8, 9を取得:\n');

// ステップ7: navigate
const step7 = steps[6];
console.log('=== STEP 7 (navigate) ===');
console.log(JSON.stringify(step7, null, 2));

// ステップ8: eval
const step8 = steps[7];
console.log('\n=== STEP 8 (eval) ===');
const step8Output = {
  type: step8.type,
  description: step8.description,
  name: step8.name,
  result_var: step8.result_var,
  postWaitSeconds: step8.postWaitSeconds,
  code: step8.code
};
console.log(JSON.stringify(step8Output, null, 2));

// ステップ9: save_follower_count
const step9 = steps[8];
console.log('\n=== STEP 9 ===');
console.log(JSON.stringify(step9, null, 2));













