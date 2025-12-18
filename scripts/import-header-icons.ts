#!/usr/bin/env tsx
/**
 * Google Drive URLリストからヘッダ画像をインポート
 * 
 * 使用方法:
 *   tsx scripts/import-header-icons.ts
 * 
 * URLリストは標準入力またはファイルから読み込む
 */

import { initDb, run, query } from '../src/drivers/db.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Google Drive URLからファイルIDを抽出
 */
function extractFileId(url: string): string | null {
  // URLからファイルIDを抽出
  // https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * ファイルIDから完全なURLを生成
 */
function buildFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view?usp=drive_link`;
}

/**
 * URLリストをパース
 */
function parseUrlList(input: string): Array<{ fileId: string; url: string }> {
  const lines = input.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  const results: Array<{ fileId: string; url: string }> = [];

  for (const line of lines) {
    // URLかファイルIDかを判定
    let fileId: string | null = null;
    
    if (line.startsWith('http')) {
      // URL形式の場合
      fileId = extractFileId(line);
      if (fileId) {
        results.push({ fileId, url: buildFileUrl(fileId) });
      }
    } else if (/^[a-zA-Z0-9_-]+$/.test(line)) {
      // ファイルIDのみの場合
      fileId = line;
      results.push({ fileId, url: buildFileUrl(fileId) });
    }
  }

  return results;
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const inputFile = process.argv[2];
  
  let inputText: string;
  
  if (inputFile) {
    // ファイルから読み込み
    const filePath = resolve(process.cwd(), inputFile);
    inputText = readFileSync(filePath, 'utf-8');
  } else {
    // 標準入力から読み込み
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    inputText = Buffer.concat(chunks).toString('utf-8');
  }

  if (!inputText || inputText.trim().length === 0) {
    console.error('使い方:');
    console.error('  tsx scripts/import-header-icons.ts [URLリストファイル]');
    console.error('');
    console.error('例:');
    console.error('  tsx scripts/import-header-icons.ts urls.txt');
    console.error('  echo "https://drive.google.com/file/d/xxx/view" | tsx scripts/import-header-icons.ts');
    process.exit(1);
  }

  // DB初期化
  initDb();
  
  // URLリストをパース
  const icons = parseUrlList(inputText);
  
  if (icons.length === 0) {
    console.error('有効なURLが見つかりませんでした');
    process.exit(1);
  }

  console.log(`インポート対象: ${icons.length}件\n`);

  let inserted = 0;
  let skipped = 0;
  const now = Date.now();

  for (const icon of icons) {
    try {
      // 既に存在する場合はスキップ
      const existing = query('SELECT id FROM header_icons WHERE file_id = ?', [icon.fileId]);
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      // 新規挿入
      run(
        'INSERT INTO header_icons (file_id, url, used, created_at) VALUES (?, ?, 0, ?)',
        [icon.fileId, icon.url, now]
      );
      inserted++;
    } catch (error: any) {
      console.error(`エラー (file_id: ${icon.fileId}):`, error.message);
    }
  }

  console.log('='.repeat(80));
  console.log('インポート結果');
  console.log('='.repeat(80));
  console.log(`新規追加: ${inserted}件`);
  console.log(`スキップ（既存）: ${skipped}件`);
  console.log(`合計: ${icons.length}件`);
  console.log('='.repeat(80));

  // 統計情報
  const stats = query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used
    FROM header_icons
  `)[0] as any;

  console.log('\n現在の統計:');
  console.log(`  合計: ${stats.total}件`);
  console.log(`  未使用: ${stats.unused}件`);
  console.log(`  使用済み: ${stats.used}件`);
}

main().catch((err) => {
  console.error('エラーが発生しました:', err);
  process.exit(1);
});
