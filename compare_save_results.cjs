const fs = require('fs');

// 成功したログ
const successLog = JSON.parse(fs.readFileSync('logs/run-18-2025-12-18T08-58-31-909Z-854715.json', 'utf8'));

// 失敗したログを探す（同じ日時の別ファイル）
const logsDir = 'logs';
const files = fs.readdirSync(logsDir).filter(f => f.startsWith('run-18-2025-12-18'));

console.log('=== プリセット18のログファイル一覧 ===\n');
files.forEach(f => {
  console.log(f);
});

// 各ログの最後のステップを確認
console.log('\n=== 各ログの最後のステップ情報 ===\n');

for (const file of files.slice(0, 5)) { // 最初の5個をチェック
  const content = JSON.parse(fs.readFileSync(`logs/${file}`, 'utf8'));
  const lastStep = content.steps[content.steps.length - 1];
  const closed = content.closed;
  const error = content.error;
  
  console.log(`${file}`);
  console.log(`  Last step (${content.steps.length - 1}): ${lastStep?.step?.name || 'N/A'}`);
  console.log(`  Last step URL: ${lastStep?.result?.body?.url || 'N/A'}`);
  console.log(`  Closed: ${closed?.ok} (closed: ${closed?.closed})`);
  if (error) {
    console.log(`  ERROR: ${error}`);
  }
  console.log();
}
