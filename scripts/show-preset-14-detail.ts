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
console.log('プリセットID 14の詳細:');
console.log(JSON.stringify(steps, null, 2));

