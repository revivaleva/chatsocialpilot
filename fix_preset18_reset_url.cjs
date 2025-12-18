const db = require('better-sqlite3')('storage/app.db');

// プリセット18を取得
const row = db.prepare('SELECT id, steps_json FROM presets WHERE id = 18 LIMIT 1').get();

if (!row) {
  console.log('Preset 18 not found');
  process.exit(1);
}

const steps = JSON.parse(row.steps_json);

console.log('=== 修正前 ===');
console.log('ステップ14の URL:', steps[14].url);

// ステップ14のURLを修正
steps[14].url = 'about:blank';

console.log('\n=== 修正後 ===');
console.log('ステップ14の URL:', steps[14].url);

// データベースに保存
const stmt = db.prepare('UPDATE presets SET steps_json = ? WHERE id = 18');
stmt.run(JSON.stringify(steps));

console.log('\n✓ プリセット18を更新しました');

// 確認
const updated = db.prepare('SELECT steps_json FROM presets WHERE id = 18').get();
const updatedSteps = JSON.parse(updated.steps_json);
console.log('確認 - ステップ14の URL:', updatedSteps[14].url);

db.close();
