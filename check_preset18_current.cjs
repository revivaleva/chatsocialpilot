const db = require('better-sqlite3')('storage/app.db');
const row = db.prepare('SELECT id, steps_json FROM presets WHERE id = 18 LIMIT 1').get();

if (!row) {
  console.log('Preset 18 not found');
  process.exit(1);
}

const steps = JSON.parse(row.steps_json);

console.log('=== プリセット18 (データベース) ===\n');
console.log('Total steps:', steps.length);

// ステップ13と14を確認
console.log('\n--- ステップ13 (Saveボタンをクリック) ---');
const step13 = steps[13];
console.log('名前:', step13.name);
console.log('タイプ:', step13.type);

console.log('\n--- ステップ14 (最後のステップ) ---');
const step14 = steps[14];
if (step14) {
  console.log('名前:', step14.name);
  console.log('タイプ:', step14.type);
  console.log('URL:', step14.url);
  console.log('全体:', JSON.stringify(step14, null, 2).substring(0, 300));
} else {
  console.log('ステップ14は存在しません');
}

db.close();
