import Database from 'better-sqlite3';

const db = new Database('storage/app.db');
const row = db.prepare('SELECT id, steps_json FROM presets WHERE id = 18').get();

if (!row) {
  console.log('Preset 18 not found');
  process.exit(1);
}

const steps = JSON.parse(row.steps_json);

// Step 13 の saveBtn.click() の直前にモーダルをスクロール一番上に戻す処理を追加
const updatedCode = steps[13].code.replace(
  'if (saveBtn.disabled || saveBtn.getAttribute(\'aria-disabled\') === \'true\') {\n      return { didAction: false, reason: \'save button still disabled after waiting\' };\n    }\n\n    saveBtn.click();',
  `if (saveBtn.disabled || saveBtn.getAttribute('aria-disabled') === 'true') {
      return { didAction: false, reason: 'save button still disabled after waiting' };
    }

    // Saveボタンをクリック前にモーダルを一番上までスクロール
    const modal = document.querySelector('[role="dialog"]');
    if (modal) {
      modal.scrollTop = 0;
      await new Promise(r => setTimeout(r, 300));
    }

    saveBtn.click();`
);

steps[13].code = updatedCode;

// DB更新
db.prepare('UPDATE presets SET steps_json = ? WHERE id = 18').run(JSON.stringify(steps));
console.log('✓ Preset 18 Step 13 updated successfully');
console.log('- Added modal scroll to top before clicking Save button');

db.close();



