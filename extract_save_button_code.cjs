const db = require('better-sqlite3')('storage/app.db');

// プリセット18を取得
const row = db.prepare('SELECT steps_json FROM presets WHERE id = 18 LIMIT 1').get();
const steps = JSON.parse(row.steps_json);

const saveStep = steps[13];

// コードを出力（スクロール処理の前後500文字）
const code = saveStep.code;
const scrollIdx = code.indexOf('scrollModal');

if (scrollIdx >= 0) {
  console.log('=== スクロール処理の前後のコード ===\n');
  const startIdx = Math.max(0, scrollIdx - 200);
  const endIdx = Math.min(code.length, scrollIdx + 700);
  
  console.log(code.substring(startIdx, endIdx));
} else {
  console.log('スクロール処理が見つかりません');
}

db.close();
