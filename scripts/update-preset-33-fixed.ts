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

// ステップ2（インデックス1）に修正したevalコードをセット
const fixedCode = "(function() { try { const textarea = document.querySelector('.notranslate.public-DraftEditor-content'); if (!textarea) { return { didAction: false, reason: 'textarea not found' }; } textarea.focus(); const text = '{{db_post_content}}'; textarea.innerText = text; textarea.textContent = text; textarea.dispatchEvent(new Event('beforeinput', { bubbles: true })); textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.dispatchEvent(new Event('change', { bubbles: true })); return { didAction: true, reason: 'text entered successfully' }; } catch(e) { return { didAction: false, reason: String(e) }; } })()";

if (steps.length > 1 && steps[1].type === 'eval') {
  steps[1].code = fixedCode;
  steps[1].name = 'リライト文を入力';
  steps[1].description = 'リライト文を入力（修正版）';
  console.log('✅ ステップ2のコードを修正しました');
} else {
  console.error('ステップ2がevalタイプではありません');
  process.exit(1);
}

const stepsJson = JSON.stringify(steps, null, 2);
updatePreset(presetId, preset.name, preset.description || '', stepsJson);

console.log('✅ プリセット33をDBに反映しました');
console.log('  - プリセット名:', preset.name);
console.log('  - ステップ2: リライト文を入力（修正版）');
console.log('    - セレクタ: .notranslate.public-DraftEditor-content');
console.log('    - 方式: innerText + textContent + イベント発火');
