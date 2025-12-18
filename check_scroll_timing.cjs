const db = require('better-sqlite3')('storage/app.db');

// プリセット18を取得
const row = db.prepare('SELECT steps_json FROM presets WHERE id = 18 LIMIT 1').get();
const steps = JSON.parse(row.steps_json);

const saveStep = steps[13];
const code = saveStep.code;

// スクロール処理とSaveボタンクリックの部分を抽出
const lines = code.split('\n');

// 関連行の検索
const scrollStartIdx = lines.findIndex(l => l.includes('scrollModal'));
const clickIdx = lines.findIndex(l => l.includes('saveBtn.click()'));

console.log('=== 現状の処理順序 ===\n');
console.log('スクロール処理の行番号:', scrollStartIdx);
console.log('Saveボタンクリックの行番号:', clickIdx);

if (scrollStartIdx >= 0 && clickIdx >= 0) {
  console.log(`\n✗ 問題: スクロール(${scrollStartIdx}) → クリック(${clickIdx}) の順序は正しい\n`);
} else if (scrollStartIdx < 0) {
  console.log('\n✗ 問題: スクロール処理が見つかりません\n');
}

console.log('=== 現在のコード片段（スクロール～クリック部分） ===\n');
const startLine = Math.max(0, scrollStartIdx - 3);
const endLine = Math.min(lines.length, clickIdx + 5);

for (let i = startLine; i < endLine; i++) {
  const prefix = i === scrollStartIdx ? '>>> ' : i === clickIdx ? '>>> ' : '    ';
  console.log(`${String(i + 1).padStart(3, ' ')} ${prefix}${lines[i]}`);
}

// modalの選択方法を確認
console.log('\n=== 選択対象の確認 ===\n');
const hasRoleDialog = code.includes('[role="dialog"]');
console.log('document.querySelector("[role="dialog"]") を使用:', hasRoleDialog);

db.close();
