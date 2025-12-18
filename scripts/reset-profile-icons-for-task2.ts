#!/usr/bin/env tsx
/**
 * プロフィール画像のused フラグをリセット
 */

import { initDb, query, run } from '../src/drivers/db.js';

function main(): void {
  initDb();

  console.log('プロフィール画像のused フラグをリセットしています...');
  run('UPDATE profile_icons SET used = 0, used_at = NULL');

  const stats = query<any>(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used
    FROM profile_icons
  `)[0];

  console.log(`✓ リセット完了`);
  console.log(`プロフィール画像: 合計${stats.total}件（未使用${stats.unused}件、使用済み${stats.used}件）`);
}

main();
