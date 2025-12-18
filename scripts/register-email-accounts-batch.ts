import { initDb, run, query } from '../src/drivers/db';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  initDb({ wal: true });
  
  // コマンドライン引数からファイルパスを取得、またはデフォルトファイルを使用
  const dataFile = process.argv[2] || path.join(__dirname, 'email-accounts-temp.txt');
  
  let lines: string[] = [];
  
  if (fs.existsSync(dataFile)) {
    // ファイルから読み込む
    const fileContent = fs.readFileSync(dataFile, 'utf-8');
    lines = fileContent
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && line.includes('@') && line.includes(':'));
  } else {
    console.error('データファイルが見つかりません:', dataFile);
    console.error('使用方法: npx tsx scripts/register-email-accounts-batch.ts [ファイルパス]');
    process.exit(1);
  }
  
  // 重複除去
  const uniqueLines = Array.from(new Set(lines));
  
  console.log(`読み込んだデータ: ${uniqueLines.length}件\n`);
  
  // 100件ずつ処理
  const BATCH_SIZE = 100;
  const totalBatches = Math.ceil(uniqueLines.length / BATCH_SIZE);
  const addedAt = Date.now();
  let totalSuccessCount = 0;
  let totalSkipCount = 0;
  const errors: string[] = [];
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIndex = batchIndex * BATCH_SIZE;
    const endIndex = Math.min(startIndex + BATCH_SIZE, uniqueLines.length);
    const batch = uniqueLines.slice(startIndex, endIndex);
    
    console.log(`バッチ ${batchIndex + 1}/${totalBatches} を処理中... (${startIndex + 1}-${endIndex}件)`);
    
    let batchSuccessCount = 0;
    let batchSkipCount = 0;
    
    for (const emailPassword of batch) {
      try {
        const result = run(
          'INSERT OR IGNORE INTO email_accounts (email_password, added_at) VALUES (?, ?)',
          [emailPassword, addedAt]
        );
        
        if (result.changes > 0) {
          batchSuccessCount++;
          totalSuccessCount++;
        } else {
          batchSkipCount++;
          totalSkipCount++;
        }
      } catch (error: any) {
        const errorMsg = error.message || String(error);
        errors.push(`${emailPassword.split(':')[0]}: ${errorMsg}`);
      }
    }
    
    console.log(`  ✓ 成功: ${batchSuccessCount}件, スキップ: ${batchSkipCount}件\n`);
  }
  
  console.log(`\n--- 登録結果 ---`);
  console.log(`成功: ${totalSuccessCount}件`);
  console.log(`スキップ（重複）: ${totalSkipCount}件`);
  if (errors.length > 0) {
    console.log(`エラー: ${errors.length}件`);
  }
  
  // 登録確認
  const totalResult = query<{count: number}>(
    'SELECT COUNT(*) as count FROM email_accounts'
  );
  console.log(`\n登録済みアカウント総数: ${totalResult[0]?.count || 0}件`);
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

