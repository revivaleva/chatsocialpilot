import { initDb, query } from '../src/drivers/db';

initDb({ wal: true });

const presets = query<{ id: number; name: string; steps_json: string }>(
  'SELECT id, name, steps_json FROM presets WHERE name LIKE ? OR name LIKE ?',
  ['%14いいね%', '%コスメオタク%']
);

console.log('該当するプリセット:');
presets.forEach(p => {
  const steps = JSON.parse(p.steps_json || '[]');
  console.log(`\n[${p.id}] ${p.name}`);
  console.log(`  ステップ数: ${steps.length}`);
  console.log(`  ステップタイプ: ${steps.map((s: any) => s.type).join(', ')}`);
});

