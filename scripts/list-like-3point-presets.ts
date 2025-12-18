import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { listPresets } from '../src/services/presets';

initDb({ wal: true });
const presets = listPresets();
const targets = presets.filter((p: any) => 
  p.name && p.name.includes('いいね3点セット')
);

console.log('いいね3点セットプリセット一覧:\n');
targets.forEach((p: any) => {
  const steps = JSON.parse(p.steps_json || '[]');
  console.log(`ID ${p.id}: ${p.name}`);
  console.log(`  ステップ数: ${steps.length}`);
  
  // 最後の3ステップを確認
  const last3 = steps.slice(-3);
  const hasFollowerSteps = last3.some((s: any) => 
    s.type === 'save_follower_count' || 
    (s.type === 'eval' && s.result_var === 'pr_follower_data') ||
    (s.type === 'navigate' && s.url && s.url.includes('{{db_container_name}}'))
  );
  console.log(`  フォロワー数ステップ: ${hasFollowerSteps ? 'あり' : 'なし'}`);
  console.log('');
});

