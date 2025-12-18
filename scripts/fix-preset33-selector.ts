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

// ステップ2のセレクタを修正
// contenteditable="true" → [data-testid="tweetTextarea_0"]
// これは Preset 27 のリプライ入力と同じセレクタ
const typeStep = {
  type: 'type',
  selector: '[data-testid="tweetTextarea_0"]',
  text: 'test',
  description: 'リライト文を入力（Preset27と同じセレクタで確実にターゲット）',
  postWaitSeconds: 2
};

if (steps.length > 2) {
  const oldSelector = steps[2].selector;
  steps[2] = typeStep;
  console.log('✅ ステップ3を修正しました');
  console.log(`  旧セレクタ: ${oldSelector}`);
  console.log(`  新セレクタ: [data-testid="tweetTextarea_0"]`);
} else {
  console.error('ステップ3が見つかりません');
  process.exit(1);
}

const stepsJson = JSON.stringify(steps, null, 2);
updatePreset(presetId, preset.name, preset.description || '', stepsJson);

console.log('✅ プリセット33をDBに反映しました');
console.log('  - ステップ3: type ステップ（セレクタ修正版）');
console.log('    - セレクタ: [data-testid="tweetTextarea_0"]（Preset27と同じ）');
console.log('    - テキスト: test');
