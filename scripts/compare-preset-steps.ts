import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset } from '../src/services/presets';

initDb({ wal: true });

// ID14とID15のステップを比較
const preset14 = getPreset(14);
const preset15 = getPreset(15);

if (!preset14 || !preset15) {
  console.error('プリセットが見つかりません');
  process.exit(1);
}

const steps14 = JSON.parse(preset14.steps_json || '[]');
const steps15 = JSON.parse(preset15.steps_json || '[]');

console.log(`\n[14] ${preset14.name}`);
console.log(`ステップ数: ${steps14.length}\n`);
steps14.forEach((step: any, i: number) => {
  const desc = step.description || step.name || '';
  const type = step.type || '';
  console.log(`  ${i+1}. [${type}] ${desc.substring(0, 60)}${desc.length > 60 ? '...' : ''}`);
  if (step.result_var) {
    console.log(`      result_var: ${step.result_var}`);
  }
  if (step.url) {
    console.log(`      url: ${step.url.substring(0, 80)}...`);
  }
});

console.log(`\n[15] ${preset15.name}`);
console.log(`ステップ数: ${steps15.length}\n`);
steps15.forEach((step: any, i: number) => {
  const desc = step.description || step.name || '';
  const type = step.type || '';
  console.log(`  ${i+1}. [${type}] ${desc.substring(0, 60)}${desc.length > 60 ? '...' : ''}`);
  if (step.result_var) {
    console.log(`      result_var: ${step.result_var}`);
  }
  if (step.url) {
    console.log(`      url: ${step.url.substring(0, 80)}...`);
  }
});













