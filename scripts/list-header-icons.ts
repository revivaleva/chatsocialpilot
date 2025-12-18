#!/usr/bin/env tsx
/**
 * ヘッダ画像の一覧を表示
 * 
 * 使用方法:
 *   tsx scripts/list-header-icons.ts                    # 全件表示
 *   tsx scripts/list-header-icons.ts --unused          # 未使用のみ
 *   tsx scripts/list-header-icons.ts --used            # 使用済みのみ
 *   tsx scripts/list-header-icons.ts --stats           # 統計情報のみ
 */

import { initDb, query } from '../src/drivers/db.js';

interface HeaderIcon {
  id: number;
  file_id: string;
  url: string;
  used: number;
  used_at: number | null;
  created_at: number;
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const showUnused = process.argv.includes('--unused');
  const showUsed = process.argv.includes('--used');
  const showStats = process.argv.includes('--stats');

  // DB初期化
  initDb();

  // 統計情報
  const stats = query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used
    FROM header_icons
  `)[0] as any;

  console.log('='.repeat(80));
  console.log('ヘッダ画像統計');
  console.log('='.repeat(80));
  console.log(`合計: ${stats.total}件`);
  console.log(`未使用: ${stats.unused}件`);
  console.log(`使用済み: ${stats.used}件`);
  console.log('='.repeat(80));

  if (showStats) {
    process.exit(0);
  }

  // 画像一覧を取得
  let sql = 'SELECT id, file_id, url, used, used_at, created_at FROM header_icons';
  const conditions: string[] = [];
  
  if (showUnused) {
    conditions.push('used = 0');
  } else if (showUsed) {
    conditions.push('used = 1');
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY created_at DESC';

  const icons = query<HeaderIcon>(sql);

  if (icons.length === 0) {
    console.log('\n画像が見つかりませんでした');
    process.exit(0);
  }

  console.log(`\n画像一覧 (${icons.length}件):\n`);

  for (const icon of icons) {
    const status = icon.used === 1 ? '✓ 使用済み' : '○ 未使用';
    const usedAt = icon.used_at ? new Date(icon.used_at).toISOString() : '-';
    console.log(`[${status}] ${icon.url}`);
    console.log(`  ファイルID: ${icon.file_id} | ID: ${icon.id} | 使用日時: ${usedAt}`);
    console.log('');
  }
}

main().catch((err) => {
  console.error('エラーが発生しました:', err);
  process.exit(1);
});
