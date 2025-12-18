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

// キー入力シミュレーション版のevalコード
const keyboardInputStep = {
  type: 'eval',
  code: `(function() {
  try {
    const textarea = document.querySelector('.notranslate.public-DraftEditor-content');
    if (!textarea) {
      return { didAction: false, reason: 'textarea not found' };
    }
    
    // フォーカスをセット
    textarea.focus();
    
    // 既存テキストをクリア
    textarea.innerText = '';
    textarea.textContent = '';
    
    // 変更イベントを発火して初期化を確認
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    
    // 入力テキスト
    const text = 'test';
    
    // 各文字をキー入力のようにシミュレート
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const code = char.charCodeAt(0);
      
      // keydown イベント
      const keydownEvent = new KeyboardEvent('keydown', {
        key: char,
        code: 'Key' + char.toUpperCase(),
        keyCode: code,
        bubbles: true,
        cancelable: true
      });
      textarea.dispatchEvent(keydownEvent);
      
      // keypress イベント
      const keypressEvent = new KeyboardEvent('keypress', {
        key: char,
        code: 'Key' + char.toUpperCase(),
        keyCode: code,
        bubbles: true,
        cancelable: true
      });
      textarea.dispatchEvent(keypressEvent);
      
      // テキストを追加
      const currentText = textarea.innerText || '';
      textarea.innerText = currentText + char;
      textarea.textContent = textarea.innerText;
      
      // input イベント（テキスト変更を通知）
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      
      // keyup イベント
      const keyupEvent = new KeyboardEvent('keyup', {
        key: char,
        code: 'Key' + char.toUpperCase(),
        keyCode: code,
        bubbles: true,
        cancelable: true
      });
      textarea.dispatchEvent(keyupEvent);
      
      // わずかな遅延を追加（非同期ではなく同期的に処理）
      // 実際にはこの処理は同期的に実行されます
    }
    
    // 最終的な変更イベント
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    textarea.dispatchEvent(new Event('blur', { bubbles: true }));
    
    const finalText = textarea.innerText || '';
    return {
      didAction: true,
      reason: 'text entered via keyboard simulation',
      enteredText: finalText,
      expectedText: 'test',
      matched: finalText.includes('test')
    };
  } catch(e) {
    return { didAction: false, reason: String(e) };
  }
})()`,
  name: 'リライト文を入力',
  postWaitSeconds: 10,
  description: 'リライト文を入力（キーボード入力シミュレーション版）'
};

// ステップ3を更新
if (steps.length > 2 && steps[2].type === 'eval') {
  steps[2] = keyboardInputStep;
  console.log('✅ ステップ3をキーボード入力版に更新しました');
} else {
  console.error('ステップ3が見つかりません');
  process.exit(1);
}

const stepsJson = JSON.stringify(steps, null, 2);
updatePreset(presetId, preset.name, preset.description || '', stepsJson);

console.log('✅ プリセット33をDBに反映しました');
console.log('  - ステップ3: キーボード入力シミュレーション版');
console.log('    - keydown/keypress/input/keyup イベントを順次発火');
console.log('    - 1文字ずつ入力をシミュレート');
