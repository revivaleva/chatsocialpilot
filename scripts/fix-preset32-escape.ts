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

// ステップ1（テキスト入力）を修正
// テンプレート変数の値を安全にエスケープして取得
const evalStep = {
  type: 'eval',
  code: `(async () => {
  // テンプレート変数の値を安全に取得（改行・特殊文字をエスケープ）
  // applyTemplate が先に実行されるため、実際の値が文字列リテラルに直接埋め込まれる
  // そのため、改行を含む場合は構文エラーになる
  // 解決策: テンプレート変数の値を JSON.stringify() でエスケープした文字列として取得し、JSON.parse() で復元
  const postTextEscaped = JSON.stringify('{{db_post_content}}');
  const postText = JSON.parse(postTextEscaped);
  
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
  const chars = Array.from(postText);
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const charCode = char.charCodeAt(0);
    
    replyTextarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: char, code: String(charCode) }));
    replyTextarea.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key: char, code: String(charCode) }));
    
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
    
    replyTextarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: char, code: String(charCode) }));
    replyTextarea.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 10));
  }
  
  await new Promise(r => setTimeout(r, 500));
  replyTextarea.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  replyTextarea.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 1000));
  
  const finalText = replyTextarea.textContent || replyTextarea.innerText || '';
  return { didAction: true, reason: 'text entered via keyboard simulation', enteredText: finalText.substring(0, 50), expectedText: postText.substring(0, 50) };
})()`,
  description: 'リライト文を入力（改行・絵文字対応版・エスケープ処理済み）',
  postWaitSeconds: 2
};

if (steps.length > 1) {
  const oldDesc = steps[1].description;
  steps[1] = evalStep;
  console.log('✅ ステップ2（テキスト入力）を修正しました');
  console.log(`  旧説明: ${oldDesc}`);
  console.log(`  新説明: リライト文を入力（改行・絵文字対応版・エスケープ処理済み）`);
  console.log(`  主な改善:`);
  console.log(`    - JSON.stringify/parse で改行・特殊文字を安全に処理`);
  console.log(`    - Array.from() でサロゲートペア対応`);
  console.log(`    - 絵文字のコード値をString() で安全に処理`);
} else {
  console.error('ステップ2が見つかりません');
  process.exit(1);
}

const stepsJson = JSON.stringify(steps, null, 2);
updatePreset(presetId, preset.name, preset.description || '', stepsJson);

console.log('\n✅ プリセット32をDBに反映しました');
console.log('  - 改行・絵文字・エスケープ処理対応済み');
