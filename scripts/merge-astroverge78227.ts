/**
 * astroverge78227の重複レコードを統合するスクリプト
 * 先ほど追加したレコード（メールアドレスあり）から既存レコード（ユーザー名・フォロワー情報あり）に情報を移して削除
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

function main() {
  initDb({ wal: true });

  const containerId = 'astroverge78227';

  // 重複レコードを取得
  const records = query<XAccountRecord>(
    'SELECT * FROM x_accounts WHERE container_id = ? ORDER BY id',
    [containerId]
  );

  console.log(`\n📋 レコード数: ${records.length}`);

  if (records.length === 0) {
    console.log(`❌ レコードが見つかりません: ${containerId}`);
    return;
  }

  if (records.length === 1) {
    console.log(`✓ 重複はありません: ${containerId}`);
    return;
  }

  // レコード情報を表示
  records.forEach((r, i) => {
    console.log(`\nレコード ${i + 1} (id: ${r.id}):`);
    console.log(`  email: ${r.email || '(空)'}`);
    console.log(`  email_password: ${r.email_password ? '***' : '(空)'}`);
    console.log(`  x_username: ${r.x_username || '(空)'}`);
    console.log(`  follower_count: ${r.follower_count ?? '(空)'}`);
    console.log(`  following_count: ${r.following_count ?? '(空)'}`);
    console.log(`  created_at: ${new Date(r.created_at).toISOString()}`);
  });

  // メールアドレスがあるレコード（先ほど追加した方）と、ユーザー名があるレコード（既存の方）を特定
  const emailRecord = records.find(r => r.email && !r.x_username);
  const usernameRecord = records.find(r => r.x_username && !r.email);

  if (!emailRecord) {
    console.log(`\n❌ メールアドレスがあるレコードが見つかりません`);
    return;
  }

  if (!usernameRecord) {
    console.log(`\n❌ ユーザー名があるレコードが見つかりません`);
    return;
  }

  console.log(`\n🔧 統合を実行します...`);
  console.log(`  保持するレコード: id=${usernameRecord.id} (ユーザー名: ${usernameRecord.x_username})`);
  console.log(`  削除するレコード: id=${emailRecord.id} (メール: ${emailRecord.email})`);

  // 既存レコード（ユーザー名がある方）にメールアドレス情報を追加
  const now = Date.now();
  run(
    `UPDATE x_accounts SET
      email = ?,
      email_password = ?,
      updated_at = ?
    WHERE id = ?`,
    [
      emailRecord.email,
      emailRecord.email_password,
      now,
      usernameRecord.id,
    ]
  );

  // 先ほど追加したレコード（メールアドレスのみ）を削除
  run('DELETE FROM x_accounts WHERE id = ?', [emailRecord.id]);

  console.log(`\n✅ 統合完了: ${containerId}`);
  console.log(`   メールアドレス情報を移しました: ${emailRecord.email}`);
  console.log(`   削除したレコード: id=${emailRecord.id}`);

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

main();
