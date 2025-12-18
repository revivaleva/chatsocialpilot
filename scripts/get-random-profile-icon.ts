#!/usr/bin/env tsx
/**
 * 未使用のプロフィール画像をランダムに取得
 * 
 * 使用方法:
 *   tsx scripts/get-random-profile-icon.ts
 *   tsx scripts/get-random-profile-icon.ts --mark-used  # 取得と同時に使用済みマーク
 */

import { initDb, run, query } from '../src/drivers/db.js';

interface ProfileIcon {
  id: number;
  file_id: string;
  url: string;
  used: number;
  used_at: number | null;
}

/**
 * 未使用の画像をランダムに取得
 */
function getRandomUnusedIcon(markAsUsed: boolean = false): ProfileIcon | null {
  // 未使用の画像を取得
  const unusedIcons = query<ProfileIcon>(
    'SELECT id, file_id, url, used, used_at FROM profile_icons WHERE used = 0 ORDER BY RANDOM() LIMIT 1'
  );

  if (unusedIcons.length === 0) {
    return null;
  }

  const icon = unusedIcons[0];

  if (markAsUsed) {
    const now = Date.now();
    run('UPDATE profile_icons SET used = 1, used_at = ? WHERE id = ?', [now, icon.id]);
    icon.used = 1;
    icon.used_at = now;
  }

  return icon;
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const markAsUsed = process.argv.includes('--mark-used');

  // DB初期化
  initDb();

  const icon = getRandomUnusedIcon(markAsUsed);

  if (!icon) {
    console.error('未使用の画像が見つかりませんでした');
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('ランダムに選択されたプロフィール画像');
  console.log('='.repeat(80));
  console.log(`ID: ${icon.id}`);
  console.log(`ファイルID: ${icon.file_id}`);
  console.log(`URL: ${icon.url}`);
  if (markAsUsed) {
    console.log(`状態: 使用済みにマークしました`);
  } else {
    console.log(`状態: 未使用（使用する場合は --mark-used オプションを使用）`);
  }
  console.log('='.repeat(80));

  // 標準出力にURLを出力（パイプで使用可能）
  console.log(icon.url);

  // 統計情報
  const stats = query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used
    FROM profile_icons
  `)[0] as any;

  console.error(`\n残り未使用: ${stats.unused}件 / 合計: ${stats.total}件`);
}

main().catch((err) => {
  console.error('エラーが発生しました:', err);
  process.exit(1);
});
