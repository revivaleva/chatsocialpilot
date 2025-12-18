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

// type ステップを使用（ネイティブ入力機構）
const typeStep = {
  type: 'type',
  selector: '.notranslate.public-DraftEditor-content',
  text: 'test',
  description: 'リライト文を入力（type ステップ - ネイティブ入力）',
  postWaitSeconds: 2
};

// ステップ3を置き換え
if (steps.length > 2) {
  steps[2] = typeStep;
  console.log('✅ ステップ3を type ステップに更新しました');
} else {
  console.error('ステップ3が見つかりません');
  process.exit(1);
}

const stepsJson = JSON.stringify(steps, null, 2);
updatePreset(presetId, preset.name, preset.description || '', stepsJson);

console.log('✅ プリセット33をDBに反映しました');
console.log('  - ステップ3: type ステップ版');
console.log('    - セレクタ: .notranslate.public-DraftEditor-content');
console.log('    - テキスト: test');
console.log('    - 方式: ネイティブ type コマンド（ブラウザの組み込み入力機構）');
