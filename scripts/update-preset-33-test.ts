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

// ステップ2（インデックス1）にテスト用evalコードをセット
const testCode = "(function() { try { const textareas = document.querySelectorAll('[contenteditable=\"true\"]'); if (textareas.length === 0) { return { didAction: false, reason: 'No contenteditable elements found', count: 0 }; } let results = []; for (let i = 0; i < textareas.length; i++) { const el = textareas[i]; const testText = `test_${i + 1}`; try { el.focus(); el.innerText = testText; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); const inserted = el.innerText; results.push({ index: i, selector: el.tagName, testClass: el.className.substring(0, 50), testText: testText, actualText: inserted, matched: inserted.includes(testText) }); } catch(e) { results.push({ index: i, error: String(e) }); } } return { didAction: true, reason: 'All contenteditable elements tested', count: textareas.length, results: results }; } catch(e) { return { didAction: false, reason: String(e) }; } })()";

if (steps.length > 1 && steps[1].type === 'eval') {
  steps[1].code = testCode;
  console.log('✅ ステップ2のコードを更新しました');
} else {
  console.error('ステップ2がevalタイプではありません');
  process.exit(1);
}

const stepsJson = JSON.stringify(steps, null, 2);
updatePreset(presetId, preset.name, preset.description || '', stepsJson);

console.log('✅ プリセット33をDBに反映しました');
console.log('  - プリセット名:', preset.name);
console.log('  - ステップ2: テスト用eval（contenteditable全要素テスト）');
