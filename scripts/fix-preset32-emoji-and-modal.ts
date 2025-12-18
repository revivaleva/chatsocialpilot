import { getPreset, updatePreset } from '../src/services/presets';
import { initDb } from '../src/drivers/db';

initDb({ wal: true });

const presetId = 32;
const preset = getPreset(presetId);

if (!preset) {
  console.error(`プリセット ${presetId} が見つかりません`);
  process.exit(1);
}

console.log(`プリセット ${presetId} を取得しました: ${preset.name}`);

const steps = JSON.parse(preset.steps_json || '[]');

// ステップ1: 利用規約モーダルを閉じる（navigateの直後）
const modalCloseStep = {
  type: 'eval',
  code: `(function() {
  try {
    // 複数のパターンでモーダルを閉じるボタンを探す
    const closeButtons = [
      ...Array.from(document.querySelectorAll('button[role="button"]')).filter(b => 
        (b.textContent || '').includes('Got it') || 
        (b.textContent || '').includes('了解') ||
        (b.getAttribute('aria-label') || '').includes('Got it') ||
        (b.getAttribute('aria-label') || '').includes('了解')
      ),
      document.querySelector('[data-testid="app-bar-close"]'),
      document.querySelector('button[aria-label*="Close"]'),
      document.querySelector('button[aria-label*="閉じる"]')
    ].filter(Boolean);
    
    if (closeButtons.length > 0) {
      closeButtons[0].click();
      return { didAction: true, reason: 'Clicked modal close button' };
    }
    
    // モーダルが見つからない場合は成功扱い（既に閉じている可能性）
    return { didAction: true, reason: 'Modal close button not found (may already be closed)' };
  } catch(e) {
    return { didAction: false, reason: String(e) };
  }
})()`,
  description: '利用規約モーダルを閉じる',
  postWaitSeconds: 2
};

// ステップ2: テキスト入力（絵文字・改行対応版）
const evalStep = {
  type: 'eval',
  code: `(async () => {
  const postText = '{{db_post_content}}';
  const replyTextarea = document.querySelector('[data-testid="tweetTextarea_0"]');
  if (!replyTextarea) { return { didAction: false, reason: 'textarea not found' }; }
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
  
  // 改行と絵文字対応：Array.from を使って正しく文字ごとに処理
  // Array.from() はサロゲートペア（絵文字）を正しく1文字として扱う
  const chars = Array.from(postText);
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    
    // サロゲートペア（絵文字）の判定：length === 2 かつ codePointAt(0) > 0xFFFF
    // 通常の文字の場合は charCodeAt(0) を使用
    const isSurrogatePair = char.length === 2 && char.codePointAt(0) > 0xFFFF;
    const charCode = !isSurrogatePair ? char.charCodeAt(0) : null;
    const eventOptions = charCode !== null 
      ? { bubbles: true, cancelable: true, key: char, code: String(charCode) }
      : { bubbles: true, cancelable: true, key: char };
    
    replyTextarea.dispatchEvent(new KeyboardEvent("keydown", eventOptions));
    replyTextarea.dispatchEvent(new KeyboardEvent("keypress", eventOptions));
    
    // document.execCommand("insertText") はサロゲートペアも正しく処理する
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
    
    replyTextarea.dispatchEvent(new KeyboardEvent("keyup", eventOptions));
    replyTextarea.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 10));
  }
  
  await new Promise(r => setTimeout(r, 500));
  replyTextarea.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  replyTextarea.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 1000));
  
  const finalText = replyTextarea.textContent || replyTextarea.innerText || '';
  return { didAction: true, reason: 'text entered via keyboard simulation', enteredText: finalText.substring(0, 100), expectedText: postText.substring(0, 100) };
})()`,
  description: 'リライト文を入力（改行・絵文字対応版）',
  postWaitSeconds: 2
};

// ステップ1にモーダル閉じるステップを挿入
if (steps.length > 0 && steps[0].type === 'navigate') {
  // 既存のステップ1（テキスト入力）をステップ2に移動
  if (steps.length > 1 && steps[1].type === 'eval') {
    steps[1] = evalStep;
    steps.splice(1, 0, modalCloseStep);
    console.log('✅ ステップ構成を更新しました');
    console.log('  ステップ0: navigate（X投稿画面を開く）');
    console.log('  ステップ1: [新規] 利用規約モーダルを閉じる');
    console.log('  ステップ2: eval（リライト文を入力 - 絵文字・改行対応版）');
  } else {
    steps.splice(1, 0, modalCloseStep);
    steps.splice(2, 0, evalStep);
    console.log('✅ ステップ構成を更新しました');
    console.log('  ステップ0: navigate（X投稿画面を開く）');
    console.log('  ステップ1: [新規] 利用規約モーダルを閉じる');
    console.log('  ステップ2: [新規] eval（リライト文を入力 - 絵文字・改行対応版）');
  }
} else {
  console.error('ステップ0がnavigateタイプではありません');
  process.exit(1);
}

const stepsJson = JSON.stringify(steps, null, 2);
updatePreset(presetId, preset.name, preset.description || '', stepsJson);

console.log('\n✅ プリセット32をDBに反映しました');
console.log('  主な改善:');
console.log('    - 利用規約モーダルを閉じるステップを追加');
console.log('    - 絵文字処理を改善（Array.from() + サロゲートペア対応）');
console.log('    - 改行文字を正しく処理');
console.log('    - KeyboardEvent の code をサロゲートペアの場合は設定しない');
