const db = require('better-sqlite3')('storage/app.db');

// プリセット18を取得
const row = db.prepare('SELECT steps_json FROM presets WHERE id = 18 LIMIT 1').get();

if (!row) {
  console.log('Preset 18 not found');
  process.exit(1);
}

const steps = JSON.parse(row.steps_json);
const saveStep = steps[13];

console.log('=== 修正前 ===\n');

const oldCode = saveStep.code;

// 古いスクロール処理パターンを特定
const oldPattern = /\/\/ Saveボタンをクリック前にモーダルを一番上までスクロール\s+const scrollModal = document\.querySelector\('\[role="dialog"\]'\);\s+if \(scrollModal\) \{\s+scrollModal\.scrollTop = 0;\s+await new Promise\(r => setTimeout\(r, 3000\)\);\s+\}/;

if (!oldPattern.test(oldCode)) {
  console.log('✗ 古いスクロール処理パターンが見つかりません');
  process.exit(1);
}

console.log('✓ 古いパターンを検出しました');

// 新しいスクロール処理（案3）
const newScrollCode = `// Saveボタンをクリック前にモーダルを一番上までスクロール
    const modal = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (modal) {
      // data-viewportview="true" のコンテナを探す
      const viewportContainer = modal.querySelector('[data-viewportview="true"]');
      if (viewportContainer) {
        viewportContainer.scrollTop = 0;
        await new Promise(r => setTimeout(r, 3000));
      }
    }`;

// コードを置き換え
const newCode = oldCode.replace(oldPattern, newScrollCode);

if (newCode === oldCode) {
  console.log('✗ 置き換えに失敗しました');
  process.exit(1);
}

console.log('✓ 新しいパターンに置き換えました\n');

// ステップ13のコードを更新
steps[13].code = newCode;

// データベースに保存
const stmt = db.prepare('UPDATE presets SET steps_json = ? WHERE id = 18');
stmt.run(JSON.stringify(steps));

console.log('=== 修正後 ===\n');
console.log('✓ プリセット18ステップ13を更新しました');

// 確認
const updated = db.prepare('SELECT steps_json FROM presets WHERE id = 18').get();
const updatedSteps = JSON.parse(updated.steps_json);
const confirmCode = updatedSteps[13].code;

// 新しいパターンが含まれているか確認
const hasNewPattern = confirmCode.includes('viewportContainer') && 
                      confirmCode.includes('[data-viewportview="true"]');

console.log('確認 - 新しいスクロール処理を適用:', hasNewPattern ? '✓' : '✗');

db.close();
