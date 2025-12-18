const db = require('better-sqlite3')('storage/app.db');

// プリセット18を取得
const row = db.prepare('SELECT steps_json FROM presets WHERE id = 18 LIMIT 1').get();

if (!row) {
  console.log('Preset 18 not found');
  process.exit(1);
}

const steps = JSON.parse(row.steps_json);
const saveStep = steps[13];

console.log('=== 修正内容 ===\n');

const oldCode = saveStep.code;

// オプショナルチェーン（?.）をすべて削除して従来の方法に置き換え
let newCode = oldCode;

// 1. btn.textContent?.trim() → (btn.textContent && btn.textContent.trim())
newCode = newCode.replace(/btn\.textContent\?\./g, 'btn.textContent && btn.textContent.');
newCode = newCode.replace(/btn\.textContent && btn\.textContent\.trim\(\)/g, '(btn.textContent && btn.textContent.trim())');

// 2. btn.getAttribute('aria-label')?.trim() → (btn.getAttribute('aria-label') && btn.getAttribute('aria-label').trim())
newCode = newCode.replace(/btn\.getAttribute\('aria-label'\)\?\./g, 'btn.getAttribute(\'aria-label\') && btn.getAttribute(\'aria-label\').');
newCode = newCode.replace(/btn\.getAttribute\('aria-label'\) && btn\.getAttribute\('aria-label'\)\.trim\(\)/g, '(btn.getAttribute(\'aria-label\') && btn.getAttribute(\'aria-label\').trim())');

// 3. btn.getAttribute('data-testid')?.toLowerCase() 
newCode = newCode.replace(/btn\.getAttribute\('data-testid'\)\?\./g, 'btn.getAttribute(\'data-testid\') && btn.getAttribute(\'data-testid\').');
newCode = newCode.replace(/btn\.getAttribute\('data-testid'\) && btn\.getAttribute\('data-testid'\)\.toLowerCase\(\)/g, '(btn.getAttribute(\'data-testid\') && btn.getAttribute(\'data-testid\').toLowerCase())');

// 4. header.textContent?.trim() 
newCode = newCode.replace(/header\.textContent\?\./g, 'header.textContent && header.textContent.');
newCode = newCode.replace(/header\.textContent && header\.textContent\.trim\(\)/g, '(header.textContent && header.textContent.trim())');

// 5. btn.textContent?.trim() (Applyボタン探索部分)
newCode = newCode.replace(/btnText\.trim\(\)/g, '(btnText && btnText.trim())');

// 6. header.querySelector内のtextContent?.trim()
newCode = newCode.replace(/titleText = header\.textContent\?\./g, 'titleText = (header.textContent && header.textContent.');

// 7. btn.getAttribute('aria-label')?.trim() (Applyボタン探索部分)
newCode = newCode.replace(/ariaLabel = btn\.getAttribute\('aria-label'\)\?\./g, 'ariaLabel = (btn.getAttribute(\'aria-label\') && btn.getAttribute(\'aria-label\').');

// さらに詳細に置き換え
newCode = newCode.replace(/btn\.textContent\?\.trim/g, '(btn.textContent && btn.textContent.trim');
newCode = newCode.replace(/text = btn\.textContent && btn\.textContent\.trim\(\) \|\| ''/g, 'text = (btn.textContent && btn.textContent.trim()) || \'\'');
newCode = newCode.replace(/ariaLabel = btn\.getAttribute\('aria-label'\) && btn\.getAttribute\('aria-label'\)\.trim/g, 'ariaLabel = (btn.getAttribute(\'aria-label\') && btn.getAttribute(\'aria-label\').trim');

// Applyボタン部分の修正
newCode = newCode.replace(/btnText = btn\.textContent\?\.trim/g, 'btnText = (btn.textContent && btn.textContent.trim');

console.log('✓ オプショナルチェーン（?.）をすべて削除しました\n');

// スクロール処理部分を改善
const oldScrollPattern = /\/\/ Saveボタンをクリック前にモーダルを一番上までスクロール\s+const modal = document\.querySelector\('\[role="dialog"\]\[aria-modal="true"\]'\);\s+if \(modal\) \{\s+\/\/ data-viewportview="true" のコンテナを探す\s+const viewportContainer = modal\.querySelector\('\[data-viewportview="true"\]'\);\s+if \(viewportContainer\) \{\s+viewportContainer\.scrollTop = 0;\s+await new Promise\(r => setTimeout\(r, 3000\)\);\s+\}\s+\}/;

const newScrollCode = `// Saveボタンをクリック前にモーダルを一番上までスクロール
    const modal = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (modal) {
      // data-viewportview="true" のコンテナを探す
      const viewportContainer = modal.querySelector('[data-viewportview="true"]');
      if (viewportContainer) {
        // スクロール前の位置を取得
        const scrollBefore = viewportContainer.scrollTop;
        console.log('Scroll position before:', scrollBefore);
        
        // スクロール処理
        viewportContainer.scrollTop = 0;
        await new Promise(r => setTimeout(r, 500)); // スクロール適用待機
        
        // スクロール後の位置を確認
        const scrollAfter = viewportContainer.scrollTop;
        console.log('Scroll position after:', scrollAfter, 'scrolled by:', scrollBefore - scrollAfter);
        
        // スクロール完了を待つ
        await new Promise(r => setTimeout(r, 2500));
      }
    }`;

newCode = newCode.replace(oldScrollPattern, newScrollCode);

if (newCode === oldCode) {
  console.log('⚠️ スクロール処理の置き換えが失敗しました（正規表現が合致しませんでした）');
  console.log('通常のスクロール処理は保持します\n');
} else {
  console.log('✓ スクロール処理を改善しました（スクロール量の取得機能を追加）\n');
}

// ステップ13のコードを更新
steps[13].code = newCode;

// データベースに保存
const stmt = db.prepare('UPDATE presets SET steps_json = ? WHERE id = 18');
stmt.run(JSON.stringify(steps));

console.log('=== 修正完了 ===\n');
console.log('✓ プリセット18ステップ13を更新しました');

// 確認
const updated = db.prepare('SELECT steps_json FROM presets WHERE id = 18').get();
const updatedSteps = JSON.parse(updated.steps_json);
const confirmCode = updatedSteps[13].code;

const hasNoOptional = !confirmCode.includes('?.') || confirmCode.match(/\?\./) === null;
const hasScrollLogging = confirmCode.includes('scrollBefore') && confirmCode.includes('scrollAfter');

console.log('確認 - オプショナルチェーン削除:', hasNoOptional ? '✓' : '✗');
console.log('確認 - スクロール量ログ機能:', hasScrollLogging ? '✓' : '✗');

db.close();
