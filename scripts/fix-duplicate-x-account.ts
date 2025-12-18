/**
 * 重複したx_accountsレコードを統合するスクリプト
 * 
 * 使用方法:
 *   npx tsx scripts/fix-duplicate-x-account.ts <container_id>
 */

import { initDb, run, query } from '../src/drivers/db';

interface XAccountRecord {
  id: number;
  container_id: string;
  email: string | null;
  email_password: string | null;
  x_password: string | null;
  follower_count: number | null;
  following_count: number | null;
  x_username: string | null;
  x_user_id: string | null;
  last_synced_at: number | null;
  created_at: number;
  updated_at: number;
  twofa_code: string | null;
  auth_token: string | null;
  ct0: string | null;
  proxy_id: number | null;
  email_changed_at: number | null;
}

function mergeRecords(records: XAccountRecord[]): Partial<XAccountRecord> {
  const merged: Partial<XAccountRecord> = {
    container_id: records[0].container_id,
  };

  // 最新のupdated_atを持つレコードを基準にする
  const sorted = [...records].sort((a, b) => b.updated_at - a.updated_at);
  const latest = sorted[0];

  // 各フィールドについて、空でない最初の値を使用
  for (const record of sorted) {
    if (!merged.email && record.email) {
      merged.email = record.email;
    }
    if (!merged.email_password && record.email_password) {
      merged.email_password = record.email_password;
    }
    if (!merged.x_password && record.x_password) {
      merged.x_password = record.x_password;
    }
    if (merged.follower_count === null && record.follower_count !== null) {
      merged.follower_count = record.follower_count;
    }
    if (merged.following_count === null && record.following_count !== null) {
      merged.following_count = record.following_count;
    }
    if (!merged.x_username && record.x_username) {
      merged.x_username = record.x_username;
    }
    if (!merged.x_user_id && record.x_user_id) {
      merged.x_user_id = record.x_user_id;
    }
    if (merged.last_synced_at === null && record.last_synced_at !== null) {
      merged.last_synced_at = record.last_synced_at;
    }
    if (!merged.twofa_code && record.twofa_code) {
      merged.twofa_code = record.twofa_code;
    }
    if (!merged.auth_token && record.auth_token) {
      merged.auth_token = record.auth_token;
    }
    if (!merged.ct0 && record.ct0) {
      merged.ct0 = record.ct0;
    }
    if (merged.proxy_id === null && record.proxy_id !== null) {
      merged.proxy_id = record.proxy_id;
    }
  }

  // 作成日時は最も古いものを使用
  merged.created_at = Math.min(...records.map(r => r.created_at));
  merged.updated_at = Date.now();

  return merged;
}

function fixDuplicateAccount(containerId: string): void {
  initDb({ wal: true });

  // 重複レコードを取得
  const records = query<XAccountRecord>(
    'SELECT * FROM x_accounts WHERE container_id = ? ORDER BY id',
    [containerId]
  );

  if (records.length === 0) {
    console.log(`❌ レコードが見つかりません: ${containerId}`);
    return;
  }

  if (records.length === 1) {
    console.log(`✓ 重複はありません: ${containerId}`);
    return;
  }

  console.log(`\n📋 重複レコードを検出: ${containerId} (${records.length}件)`);
  records.forEach((r, i) => {
    console.log(`\nレコード ${i + 1} (id: ${r.id}):`);
    console.log(`  email: ${r.email || '(空)'}`);
    console.log(`  x_username: ${r.x_username || '(空)'}`);
    console.log(`  follower_count: ${r.follower_count ?? '(空)'}`);
    console.log(`  following_count: ${r.following_count ?? '(空)'}`);
    console.log(`  created_at: ${new Date(r.created_at).toISOString()}`);
  });

  // レコードを統合
  const merged = mergeRecords(records);
  console.log(`\n🔧 統合データ:`);
  console.log(JSON.stringify(merged, null, 2));

  // 最も古いレコード（idが最小）を残して、他のレコードを削除
  const keepId = Math.min(...records.map(r => r.id));
  const deleteIds = records.filter(r => r.id !== keepId).map(r => r.id);

  console.log(`\n📝 統合を実行します...`);
  console.log(`  保持するレコード: id=${keepId}`);
  console.log(`  削除するレコード: id=${deleteIds.join(', ')}`);

  // 保持するレコードを更新
  run(
    `UPDATE x_accounts SET
      email = ?,
      email_password = ?,
      x_password = ?,
      follower_count = ?,
      following_count = ?,
      x_username = ?,
      x_user_id = ?,
      last_synced_at = ?,
      twofa_code = ?,
      auth_token = ?,
      ct0 = ?,
      proxy_id = ?,
      created_at = ?,
      updated_at = ?
    WHERE id = ?`,
    [
      merged.email || null,
      merged.email_password || null,
      merged.x_password || null,
      merged.follower_count ?? null,
      merged.following_count ?? null,
      merged.x_username || null,
      merged.x_user_id || null,
      merged.last_synced_at ?? null,
      merged.twofa_code || null,
      merged.auth_token || null,
      merged.ct0 || null,
      merged.proxy_id ?? null,
      merged.created_at,
      merged.updated_at,
      keepId,
    ]
  );

  // 他のレコードを削除
  for (const deleteId of deleteIds) {
    run('DELETE FROM x_accounts WHERE id = ?', [deleteId]);
  }

  console.log(`\n✅ 統合完了: ${containerId}`);
  console.log(`   削除したレコード数: ${deleteIds.length}`);

  // 確認
  const final = query<XAccountRecord>(
    'SELECT * FROM x_accounts WHERE container_id = ?',
    [containerId]
  );
  console.log(`\n📊 最終状態: ${final.length}件のレコード`);
  if (final.length > 0) {
    const r = final[0];
    console.log(`  id: ${r.id}`);
    console.log(`  email: ${r.email || '(空)'}`);
    console.log(`  x_username: ${r.x_username || '(空)'}`);
    console.log(`  follower_count: ${r.follower_count ?? '(空)'}`);
    console.log(`  following_count: ${r.following_count ?? '(空)'}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('❌ container_idを指定してください');
    console.error('');
    console.error('使用方法:');
    console.error('  npx tsx scripts/fix-duplicate-x-account.ts <container_id>');
    process.exit(1);
  }

  const containerId = args[0];
  fixDuplicateAccount(containerId);
}

main();
