#!/usr/bin/env tsx
/**
 * プロフィール画像を使用済みにマーク
 * 
 * 使用方法:
 *   tsx scripts/mark-profile-icon-used.ts <file_id or url>
 * 
 * 例:
 *   tsx scripts/mark-profile-icon-used.ts 1dbcJxxIHx86RyLMwZNN0DGi3sy-BGHG6
 *   tsx scripts/mark-profile-icon-used.ts "https://drive.google.com/file/d/1dbcJxxIHx86RyLMwZNN0DGi3sy-BGHG6/view"
 */

import { initDb, run, query } from '../src/drivers/db.js';

/**
 * URLまたはファイルIDからファイルIDを抽出
 */
function extractFileId(input: string): string | null {
  // URL形式の場合
  const urlMatch = input.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }
  
  // ファイルIDのみの場合
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

  if (!input) {
    console.error('使い方: tsx scripts/mark-profile-icon-used.ts <file_id or url>');
    console.error('');
    console.error('例:');
    console.error('  tsx scripts/mark-profile-icon-used.ts 1dbcJxxIHx86RyLMwZNN0DGi3sy-BGHG6');
    console.error('  tsx scripts/mark-profile-icon-used.ts "https://drive.google.com/file/d/1dbcJxxIHx86RyLMwZNN0DGi3sy-BGHG6/view"');
    process.exit(1);
  }

  // DB初期化
  initDb();

  const fileId = extractFileId(input);
  
  if (!fileId) {
    console.error('エラー: ファイルIDを抽出できませんでした');
    process.exit(1);
  }

  // 画像を検索
  const icons = query<{ id: number; file_id: string; url: string; used: number }>(
    'SELECT id, file_id, url, used FROM profile_icons WHERE file_id = ?',
    [fileId]
  );

  if (icons.length === 0) {
    console.error(`エラー: ファイルID "${fileId}" の画像が見つかりませんでした`);
    process.exit(1);
  }

  const icon = icons[0];

  if (icon.used === 1) {
    console.log(`画像は既に使用済みです: ${icon.url}`);
    process.exit(0);
  }

  // 使用済みにマーク
  const now = Date.now();
  run('UPDATE profile_icons SET used = 1, used_at = ? WHERE id = ?', [now, icon.id]);

  console.log('='.repeat(80));
  console.log('画像を使用済みにマークしました');
  console.log('='.repeat(80));
  console.log(`ID: ${icon.id}`);
  console.log(`ファイルID: ${icon.file_id}`);
  console.log(`URL: ${icon.url}`);
  console.log(`マーク日時: ${new Date(now).toISOString()}`);
  console.log('='.repeat(80));
}

main().catch((err) => {
  console.error('エラーが発生しました:', err);
  process.exit(1);
});
