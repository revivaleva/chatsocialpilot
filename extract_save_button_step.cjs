const db = require('better-sqlite3')('storage/app.db');
const row = db.prepare('SELECT steps_json FROM presets WHERE id = 18 LIMIT 1').get();

if (!row) {
  console.log('Preset 18 not found');
  process.exit(1);
}

const steps = JSON.parse(row.steps_json);

// ステップ13（Saveボタンクリック）を取得
const saveStep = steps[13]; // インデックスは0から始まる

console.log('=== プリセット18 ステップ13 (Saveボタンをクリック) ===\n');
console.log('Step name:', saveStep.name);
console.log('Step type:', saveStep.type);

// スクロール処理に関する部分を抽出
const code = saveStep.code;
const lines = code.split('\n');

// scrollModal に関する行を検索
const scrollIndex = lines.findIndex(l => l.includes('scrollModal'));

if (scrollIndex >= 0) {
  console.log('\n=== スクロール処理部分 ===\n');
  const relevantLines = lines.slice(Math.max(0, scrollIndex - 2), Math.min(lines.length, scrollIndex + 8));
  console.log(relevantLines.join('\n'));
}

// コード全体から scrollModal を検索
const hasScroll = code.includes('scrollModal');
console.log('\n=== 確認 ===');
console.log('scrollModal 処理を含む:', hasScroll);

db.close();
