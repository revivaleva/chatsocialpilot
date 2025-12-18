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

console.log(`総ステップ数: ${steps.length}`);
console.log('\n=== ステップ7 (index 6) ===');
console.log(JSON.stringify(steps[6], null, 2));
console.log('\n=== ステップ8 (index 7) ===');
console.log(JSON.stringify({
  type: steps[7].type,
  description: steps[7].description,
  name: steps[7].name,
  result_var: steps[7].result_var,
  postWaitSeconds: steps[7].postWaitSeconds,
  code_length: steps[7].code ? steps[7].code.length : 0
}, null, 2));
console.log('\n=== ステップ9 (index 8) ===');
console.log(JSON.stringify(steps[8], null, 2));

// ステップ8のcodeを完全に取得
if (steps[7] && steps[7].code) {
  console.log('\n=== ステップ8のcode (完全版) ===');
  console.log(steps[7].code);
}
