import { initDb, query } from '../src/drivers/db';
import fs from 'node:fs';
import path from 'node:path';

initDb({ wal: true });

const preset = query('SELECT id, name, description, steps_json FROM presets WHERE id = 29')[0] as any;
if (!preset) {
  console.error('❌ プリセット ID 29 が見つかりません');
  process.exit(1);
}

const steps = JSON.parse(preset.steps_json || '[]');
const newPreset = {
  name: preset.name,
  description: preset.description,
  steps: steps
};

const outputPath = path.resolve('presets', 'follower-count-only.json');
fs.writeFileSync(outputPath, JSON.stringify(newPreset, null, 2), 'utf8');
console.log(`✅ JSONファイルを更新しました: ${outputPath}`);

