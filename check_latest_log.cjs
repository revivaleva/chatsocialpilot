const fs = require('fs');

// run-18-2025-12-18T08-58-31-909Z-854715 を確認
const logFile = 'logs/run-18-2025-12-18T08-58-31-909Z-854715.json';
const content = JSON.parse(fs.readFileSync(logFile, 'utf8'));

console.log('=== 最新ログの詳細 ===\n');
console.log('ファイル:', logFile);
console.log('Total steps:', content.steps.length);
console.log('Last step index:', content.steps.length - 1);
console.log('Last step name:', content.steps[content.steps.length - 1]?.step?.name);
console.log('Last step type:', content.steps[content.steps.length - 1]?.step?.type);
console.log('Last step URL:', content.steps[content.steps.length - 1]?.result?.body?.url);
console.log('\nClosed:', content.closed);
console.log('Error:', content.error || 'なし');
console.log('\n=== ステップ14（最後）の内容 ===\n');

const lastStep = content.steps[content.steps.length - 1];
console.log('Step:', JSON.stringify(lastStep.step, null, 2).substring(0, 300));
