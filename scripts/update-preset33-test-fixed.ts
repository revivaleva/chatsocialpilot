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

// ステップ2：モーダルボタンが見つからない場合も成功扱いにする
const modalCloseStep = {
  type: 'eval',
  code: "(function() { try { const button = Array.from(document.querySelectorAll('button[role=\"button\"]')).find(b => b.textContent.includes('Got it')); if (button) { button.click(); } return { didAction: true, reason: button ? 'Clicked Got it button' : 'Got it button not found, but continuing' }; } catch(e) { return { didAction: true, reason: 'Error occurred but continuing: ' + String(e) }; } })()",
  description: '利用規約モーダルを閉じる',
  postWaitSeconds: 2
};

// ステップ3：テスト用に"test"を入力
const textInputStep = {
  type: 'eval',
  code: "(function() { try { const textarea = document.querySelector('.notranslate.public-DraftEditor-content'); if (!textarea) { return { didAction: false, reason: 'textarea not found' }; } textarea.focus(); const text = 'test'; textarea.innerText = text; textarea.textContent = text; textarea.dispatchEvent(new Event('beforeinput', { bubbles: true })); textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.dispatchEvent(new Event('change', { bubbles: true })); return { didAction: true, reason: 'text entered successfully' }; } catch(e) { return { didAction: false, reason: String(e) }; } })()",
  name: 'リライト文を入力',
  postWaitSeconds: 10,
  description: 'リライト文を入力（テスト版 - "test"を入力）'
};

// ステップを更新
if (steps.length > 1 && steps[0].type === 'navigate') {
  steps[1] = modalCloseStep;
  steps[2] = textInputStep;
  console.log('✅ ステップ2とステップ3を更新しました');
} else {
  console.error('ステップ構成が正しくありません');
  process.exit(1);
}

const stepsJson = JSON.stringify(steps, null, 2);
updatePreset(presetId, preset.name, preset.description || '', stepsJson);

console.log('✅ プリセット33をDBに反映しました');
console.log('  - ステップ1: navigate');
console.log('  - ステップ2: 利用規約モーダルを閉じる（見つからない場合も成功扱い）');
console.log('  - ステップ3: リライト文を入力（テスト版 - "test"を入力）');
