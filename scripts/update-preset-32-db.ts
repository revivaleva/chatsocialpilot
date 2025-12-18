import { getPreset, updatePreset } from '../src/services/presets';
import { initDb } from '../src/drivers/db';
import fs from 'fs';

initDb({ wal: true });

const presetId = 32;
const preset = getPreset(presetId);

if (!preset) {
  console.error(`プリセット ${presetId} が見つかりません`);
  process.exit(1);
}

// presets/x-post-with-local-media.json から最新の内容を読み込む
const presetJson = JSON.parse(fs.readFileSync('./presets/x-post-with-local-media.json', 'utf-8'));

const stepsJson = JSON.stringify(presetJson.steps, null, 2);
updatePreset(presetId, presetJson.name, presetJson.description, stepsJson);

console.log('✅ プリセット32をDBに反映しました');
console.log('  - ステップ数:', presetJson.steps.length);
console.log('  - ステップ2:', presetJson.steps[1].description);

