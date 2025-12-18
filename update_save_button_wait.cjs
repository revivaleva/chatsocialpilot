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

// スクロール処理の部分を確認
const oldCode = saveStep.code;
const hasOldWait = oldCode.includes('await new Promise(r => setTimeout(r, 300))');
console.log('300ms待機を含む:', hasOldWait);

if (!hasOldWait) {
  console.log('✗ 300ms待機が見つかりません');
  process.exit(1);
}

// 待機時間を修正（300ms → 3000ms）
const newCode = oldCode.replace(
  'await new Promise(r => setTimeout(r, 300));',
  'await new Promise(r => setTimeout(r, 3000));'
);

console.log('\n=== 修正後 ===\n');
const hasNewWait = newCode.includes('await new Promise(r => setTimeout(r, 3000))');
console.log('3000ms待機に変更:', hasNewWait);

if (!hasNewWait) {
  console.log('✗ 修正に失敗しました');
  process.exit(1);
}

// ステップ13のコードを更新
steps[13].code = newCode;

// データベースに保存
const stmt = db.prepare('UPDATE presets SET steps_json = ? WHERE id = 18');
stmt.run(JSON.stringify(steps));

console.log('\n✓ プリセット18ステップ13を更新しました');

// 確認
const updated = db.prepare('SELECT steps_json FROM presets WHERE id = 18').get();
const updatedSteps = JSON.parse(updated.steps_json);
const confirmCode = updatedSteps[13].code;
const confirmWait = confirmCode.includes('await new Promise(r => setTimeout(r, 3000))');
console.log('確認 - 3000ms待機:', confirmWait);

db.close();
