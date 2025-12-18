#!/usr/bin/env tsx
/**
 * プロフィール画像の使用済みフラグをリセット
 * 
 * 使用方法:
 *   tsx scripts/reset-profile-icons.ts              # 全件リセット
 *   tsx scripts/reset-profile-icons.ts <file_id>    # 特定の画像のみリセット
 */

import { initDb, run, query } from '../src/drivers/db.js';

/**
 * URLまたはファイルIDからファイルIDを抽出
 */
function extractFileId(input: string): string | null {
  const urlMatch = input.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }
  if (/^[a-zA-Z0-9_-]+$/.test(input)) {
    return input;
  }
  return null;
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const input = process.argv[2];

  // DB初期化
  initDb();

  if (input) {
    // 特定の画像をリセット
    const fileId = extractFileId(input);
    
    if (!fileId) {
      console.error('エラー: ファイルIDを抽出できませんでした');
      process.exit(1);
    }

    const icons = query<{ id: number; file_id: string; url: string }>(
      'SELECT id, file_id, url FROM profile_icons WHERE file_id = ?',
      [fileId]
    );

    if (icons.length === 0) {
      console.error(`エラー: ファイルID "${fileId}" の画像が見つかりませんでした`);
      process.exit(1);
    }

    run('UPDATE profile_icons SET used = 0, used_at = NULL WHERE file_id = ?', [fileId]);
    console.log(`画像をリセットしました: ${icons[0].url}`);
  } else {
    // 全件リセット
    const result = run('UPDATE profile_icons SET used = 0, used_at = NULL WHERE used = 1');
    console.log(`リセットした画像数: ${result.changes}件`);
  }

  // 統計情報
  const stats = query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used
    FROM profile_icons
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
