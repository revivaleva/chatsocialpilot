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

// ステップ2をeval方式に修正（Preset27と同じアプローチ）
const evalStep = {
  type: 'eval',
  code: `(async () => {
  const replyText = 'test';
  const replyTextarea = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (!replyTextarea) { return { didAction: false, reason: 'reply textarea not found' }; }
  replyTextarea.focus();
  replyTextarea.click();
  await new Promise(r => setTimeout(r, 500));
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(replyTextarea);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  await new Promise(r => setTimeout(r, 200));
  for (let i = 0; i < replyText.length; i++) {
    const char = replyText[i];
    replyTextarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: char, code: char.charCodeAt(0) }));
    replyTextarea.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key: char, code: char.charCodeAt(0) }));
    if (document.execCommand) {
      document.execCommand("insertText", false, char);
    } else {
      const textNode = document.createTextNode(char);
      const range = sel.getRangeAt(0);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    replyTextarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: char, code: char.charCodeAt(0) }));
    replyTextarea.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 10));
  }
  await new Promise(r => setTimeout(r, 500));
  replyTextarea.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  replyTextarea.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 1000));
  const finalText = replyTextarea.textContent || replyTextarea.innerText || '';
  return { didAction: true, reason: 'text entered via keyboard simulation', enteredText: finalText, expectedText: 'test', matched: finalText.includes('test') };
})()`,
  description: 'リライト文を入力（eval方式 - Preset27と同じ手法で確実に入力）',
  postWaitSeconds: 2
};

if (steps.length > 2) {
  const oldType = steps[2].type;
  steps[2] = evalStep;
  console.log('✅ ステップ3を修正しました');
  console.log(`  旧方式: ${oldType} ステップ`);
  console.log(`  新方式: eval ステップ（Preset27と同じアプローチ）`);
  console.log(`  ターゲット: [data-testid="tweetTextarea_0"]`);
} else {
  console.error('ステップ3が見つかりません');
  process.exit(1);
}

const stepsJson = JSON.stringify(steps, null, 2);
updatePreset(presetId, preset.name, preset.description || '', stepsJson);

console.log('✅ プリセット33をDBに反映しました');
console.log('  - ステップ3: eval ステップ（修正版）');
console.log('    - 方式: document.execCommand() + KeyboardEvent（Preset27と同じ）');
console.log('    - ターゲット: [data-testid="tweetTextarea_0"]（正確なセレクタ）');
console.log('    - テキスト: test');
