const db = require('better-sqlite3')('storage/app.db');

// プリセット18を取得
const row = db.prepare('SELECT steps_json FROM presets WHERE id = 18 LIMIT 1').get();

if (!row) {
  console.log('Preset 18 not found');
  process.exit(1);
}

const steps = JSON.parse(row.steps_json);

console.log('=== プリセット18全体の修正 ===\n');
console.log(`総ステップ数: ${steps.length}\n`);

let modifiedCount = 0;

// すべてのステップをループ
for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  
  // コードを含むステップのみ修正対象
  if (step.code) {
    const originalCode = step.code;
    let modifiedCode = originalCode;
    
    // すべてのオプショナルチェーン（?.）を削除
    // パターン1: .property?.method()
    modifiedCode = modifiedCode.replace(/\.(\w+)\?\./g, '.textContent && $1.');
    
    // パターン2: variable?.trim()
    modifiedCode = modifiedCode.replace(/textContent\?\.trim/g, 'textContent && textContent.trim');
    modifiedCode = modifiedCode.replace(/ariaLabel\?\.trim/g, 'ariaLabel && ariaLabel.trim');
    
    // パターン3: 汎用的な?.の処理
    // .getAttribute('...')?.trim() → (getAttribute('...') && getAttribute('...').trim())
    modifiedCode = modifiedCode.replace(/getAttribute\('([^']+)'\)\?\.trim\(\)/g, 
      (match, attr) => `(getAttribute('${attr}') && getAttribute('${attr}').trim())`);
    
    // パターン4: その他の?. 
    modifiedCode = modifiedCode.replace(/\.textContent\?\.trim\(\)/g, 
      '(textContent && textContent.trim())');
    modifiedCode = modifiedCode.replace(/\.getAttribute\('aria-label'\)\?\.trim\(\)/g,
      "(getAttribute('aria-label') && getAttribute('aria-label').trim())");
    modifiedCode = modifiedCode.replace(/\.getAttribute\('data-testid'\)\?\.trim\(\)/g,
      "(getAttribute('data-testid') && getAttribute('data-testid').trim())");
    
    // より詳細なパターン対応
    // header.textContent?.trim() || ''
    modifiedCode = modifiedCode.replace(/(\w+)\.textContent\?\./g, '$1.textContent && $1.textContent.');
    
    // btn.textContent?.trim()
    modifiedCode = modifiedCode.replace(/btn\.textContent\?\./g, 'btn.textContent && btn.textContent.');
    modifiedCode = modifiedCode.replace(/header\.textContent\?\./g, 'header.textContent && header.textContent.');
    modifiedCode = modifiedCode.replace(/btnText\?\./g, 'btnText && btnText.');
    
    // btn.getAttribute('aria-label')?.trim()
    modifiedCode = modifiedCode.replace(/btn\.getAttribute\('aria-label'\)\?\./g, 
      "btn.getAttribute('aria-label') && btn.getAttribute('aria-label').");
    modifiedCode = modifiedCode.replace(/header\.getAttribute\('aria-label'\)\?\./g,
      "header.getAttribute('aria-label') && header.getAttribute('aria-label').");
    modifiedCode = modifiedCode.replace(/ariaLabel\?\./g, 'ariaLabel && ariaLabel.');
    
    // 最後に残っている?.を削除
    if (modifiedCode.includes('?.')) {
      // 残っているすべての?. を削除（危険だが必要）
      modifiedCode = modifiedCode.replace(/\?\./g, ' && ');
    }
    
    if (modifiedCode !== originalCode) {
      steps[i].code = modifiedCode;
      modifiedCount++;
      console.log(`✓ ステップ${i} (${step.name}): 修正完了`);
    }
  }
}

console.log(`\n修正したステップ: ${modifiedCount}/${steps.length}\n`);

// データベースに保存
const stmt = db.prepare('UPDATE presets SET steps_json = ? WHERE id = 18');
stmt.run(JSON.stringify(steps));

console.log('=== 修正完了 ===\n');
console.log('✓ プリセット18全体を更新しました');

// 確認：残っている?.の数をカウント
let remainingOptional = 0;
for (let i = 0; i < steps.length; i++) {
  if (steps[i].code) {
    const matches = steps[i].code.match(/\?\./g);
    if (matches) {
      remainingOptional += matches.length;
      console.log(`⚠️ ステップ${i} (${steps[i].name}): まだ ${matches.length} 個の ?. が残っています`);
    }
  }
}

if (remainingOptional === 0) {
  console.log('\n✓ すべてのオプショナルチェーン（?.）を削除しました！');
} else {
  console.log(`\n✗ まだ ${remainingOptional} 個のオプショナルチェーンが残っています`);
}

db.close();
