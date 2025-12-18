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

// モーダルを閉じるevalステップを作成
const modalCloseStep = {
  type: 'eval',
  code: "(function() { try { const button = Array.from(document.querySelectorAll('button[role=\"button\"]')).find(b => b.textContent.includes('Got it')); if (!button) { return { didAction: false, reason: 'Got it button not found' }; } button.click(); return { didAction: true, reason: 'Clicked Got it button' }; } catch(e) { return { didAction: false, reason: String(e) }; } })()",
  description: '利用規約モーダルを閉じる',
  postWaitSeconds: 2
};

// ステップ1（navigate の直後）に挿入
if (steps.length > 0 && steps[0].type === 'navigate') {
  steps.splice(1, 0, modalCloseStep);
  console.log('✅ モーダル閉じるステップを追加しました（位置：ステップ2）');
} else {
  console.error('ステップ0がnavigateタイプではありません');
  process.exit(1);
}

const stepsJson = JSON.stringify(steps, null, 2);
updatePreset(presetId, preset.name, preset.description || '', stepsJson);

console.log('✅ プリセット33をDBに反映しました');
console.log('  - プリセット名:', preset.name);
console.log('  - ステップ1: navigate');
console.log('  - ステップ2: [新規] 利用規約モーダルを閉じる');
console.log('  - ステップ3: リライト文を入力');
