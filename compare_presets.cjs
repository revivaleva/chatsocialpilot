const db = require('better-sqlite3')('storage/app.db');

const presets = [22, 18];
const results = {};

for (const presetId of presets) {
  const row = db.prepare('SELECT id, name, steps_json FROM presets WHERE id = ? LIMIT 1').get(presetId);
  
  if (!row) {
    console.log(`Preset ${presetId} not found`);
    continue;
  }

  results[presetId] = {
    name: row.name,
    steps: JSON.parse(row.steps_json)
  };
}

console.log('=== プリセット22 (Xメールアドレス変更) ===');
console.log('Name:', results[22].name);
console.log('Total steps:', results[22].steps.length);
console.log('Steps:');
results[22].steps.forEach((s, i) => {
  console.log(`  [${i}] type: ${s.type}, name: ${s.name || '(no name)'}`);
});

console.log('\n=== プリセット18 (プロフィール変更) ===');
console.log('Name:', results[18].name);
console.log('Total steps:', results[18].steps.length);
console.log('Steps:');
results[18].steps.forEach((s, i) => {
  console.log(`  [${i}] type: ${s.type}, name: ${s.name || '(no name)'}`);
});

console.log('\n=== 比較：コンテナステップの有無 ===');
const has22Container = results[22].steps.some(s => s.type === 'container' || s.type === 'open_container');
const has18Container = results[18].steps.some(s => s.type === 'container' || s.type === 'open_container');

console.log(`Preset 22 has container step: ${has22Container}`);
console.log(`Preset 18 has container step: ${has18Container}`);

console.log('\n=== 比較：最後のステップ ===');
const last22 = results[22].steps[results[22].steps.length - 1];
const last18 = results[18].steps[results[18].steps.length - 1];

console.log('Preset 22 last step type:', last22.type);
console.log('Preset 18 last step type:', last18.type);
