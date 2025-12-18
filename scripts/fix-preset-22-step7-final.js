const Database = require('better-sqlite3');

const db = new Database('storage/app.db');

try {
  const preset = db.prepare('SELECT steps_json FROM presets WHERE id = 22').get();
  const steps = JSON.parse(preset.steps_json);

  console.log('=== Before Fix ===');
  console.log('Step 7 parameters:', JSON.stringify(steps[7].parameters));

  // 修正: parameters オブジェクトを空にして、
  // eval code内で直接テンプレート変数 {{pr_verification_code}} を使用
  steps[7].parameters = {};

  // eval code内を修正
  steps[7].code = steps[7].code.replace(
    /const verificationCode = '{{parameters\.pr_verification_code}}'/g,
    "const verificationCode = '{{pr_verification_code}}'"
  );

  console.log('\n=== After Fix ===');
  console.log('Step 7 parameters:', JSON.stringify(steps[7].parameters));
  console.log('Code uses direct template:', steps[7].code.includes("const verificationCode = '{{pr_verification_code}}'"));

  // DB更新
  db.prepare('UPDATE presets SET steps_json = ? WHERE id = 22').run(JSON.stringify(steps));
  console.log('\n✅ DB更新完了！');

} finally {
  db.close();
}
