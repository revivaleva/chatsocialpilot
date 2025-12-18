import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { listPresets } from '../src/services/presets';

initDb({ wal: true });
const presets = listPresets();
const targets = presets.filter((p: any) => 
  p.name && p.name.includes('いいね3点セット')
).sort((a: any, b: any) => a.id - b.id);

console.log('いいね3点セットプリセット - ステップ構成確認\n');

targets.forEach((p: any) => {
  const steps = JSON.parse(p.steps_json || '[]');
  console.log(`[${p.id}] ${p.name}`);
  
  // 最初の3ステップを確認
  const first3 = steps.slice(0, 3);
  const isMoved = 
    first3[0]?.type === 'navigate' && first3[0]?.url?.includes('{{db_container_name}}') &&
    first3[1]?.type === 'eval' && first3[1]?.result_var === 'pr_follower_data' &&
    first3[2]?.type === 'save_follower_count';
  
  console.log(`  最初の3ステップ:`);
  first3.forEach((s: any, i: number) => {
    const name = s.name || s.description || '';
    console.log(`    ${i + 1}. ${s.type}: ${name}`);
  });
  console.log(`  移動状態: ${isMoved ? '✅ 移動済み' : '❌ 未移動'}`);
  console.log('');
});

