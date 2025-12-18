import { getPreset } from '../src/services/presets';
import { initDb } from '../src/drivers/db';
import * as fs from 'fs';

initDb({ wal: true });

const preset = getPreset(27);

if (preset) {
  const steps = JSON.parse(preset.steps_json || '[]');
  fs.writeFileSync('preset27_dump.json', JSON.stringify(steps, null, 2), 'utf-8');
  console.log(`Saved ${steps.length} steps to preset27_dump.json`);
  console.log(`File size: ${fs.statSync('preset27_dump.json').size} bytes`);
} else {
  console.error('Preset 27 not found');
}
