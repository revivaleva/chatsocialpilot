import { getPreset, updatePreset } from '../src/services/presets';
import { initDb } from '../src/drivers/db';

initDb({ wal: true });

const presetId = 33;
const preset = getPreset(presetId);

if (!preset) {
  console.error(`プリセット ${presetId} が見つかりません`);
  process.exit(1);
}

console.log(`プリセット ${presetId} を取得しました: ${preset.name}`);

const steps = JSON.parse(preset.steps_json || '[]');

// 修正版：posting.ts の typeIntoEditor を参考に
// contenteditable="true" + keyboard.type（遅延付き）
const typeStep = {
  type: 'type',
  selector: '[contenteditable="true"]',
  text: 'test',
  description: 'リライト文を入力（contenteditable版 - 投稿サービスと同じアプローチ）',
  postWaitSeconds: 2
};

// ステップ3を置き換え
if (steps.length > 2) {
  steps[2] = typeStep;
  console.log('✅ ステップ3を修正しました');
} else {
  console.error('ステップ3が見つかりません');
  process.exit(1);
}

const stepsJson = JSON.stringify(steps, null, 2);
updatePreset(presetId, preset.name, preset.description || '', stepsJson);

console.log('✅ プリセット33をDBに反映しました');
console.log('  - ステップ3: type ステップ（修正版）');
console.log('    - セレクタ: [contenteditable="true"]（より汎用的）');
console.log('    - テキスト: test');
console.log('    - 方式: posting.ts の typeIntoEditor と同じアプローチ');
