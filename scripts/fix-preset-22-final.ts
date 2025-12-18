import Database from 'better-sqlite3';

const db = new Database('c:\\workspace\\chatsocialpilot\\storage\\app.db');

try {
  const preset = db.prepare('SELECT * FROM presets WHERE id = 22').get();
  const stepsJson = preset.steps_json;
  const steps = JSON.parse(stepsJson);

  console.log('=== Step 7 before ===');
  console.log('Name:', steps[7]?.name);
  console.log('Parameters:', JSON.stringify(steps[7]?.parameters));

  if (steps[7]) {
    // parameters オブジェクトを修正
    steps[7].parameters = {
      pr_verification_code: '{{pr_verification_code}}'
    };

    // コード内の参照を修正
    steps[7].code = steps[7].code.replace(
      /parameters\.verification_code/g,
      'parameters.pr_verification_code'
    );

    // DBを更新
    db.prepare('UPDATE presets SET steps_json = ? WHERE id = 22').run(
      JSON.stringify(steps)
    );

    console.log('\n=== Step 7 after ===');
    console.log('Parameters:', JSON.stringify(steps[7].parameters));
    console.log('Code contains pr_verification_code:', steps[7].code.includes('pr_verification_code'));
    console.log('\n✅ DB修正完了！');
  }
} finally {
  db.close();
}

