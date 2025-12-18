/**
 * email_accountsテーブルから未使用のメールアドレスを取得して
 * x_accountsテーブルの指定コンテナに設定するスクリプト
 * 
 * 使用方法:
 *   npx tsx scripts/update-x-account-email-from-table.ts <container_id>
 */

import { initDb, run, query } from '../src/drivers/db';

interface EmailAccount {
  id: number;
  email_password: string; // email:password形式
  added_at: number;
  used_at: number | null;
}

function parseEmailPassword(emailPassword: string): { email: string; password: string } | null {
  const parts = emailPassword.split(':');
  if (parts.length < 2) {
    return null;
  }
  return {
    email: parts[0],
    password: parts.slice(1).join(':'), // パスワードにコロンが含まれる場合に対応
  };
}

function main() {
  const args = process.argv.slice(2);
  const containerId = args[0] || 'astroverge78227';

  initDb({ wal: true });

  console.log(`\n📋 コンテナID: ${containerId}\n`);

  // 現在のx_accountsレコードを確認
  const xAccount = query<{
    id: number;
    container_id: string;
    email: string | null;
    email_password: string | null;
  }>(
    'SELECT id, container_id, email, email_password FROM x_accounts WHERE container_id = ?',
    [containerId]
  );

  if (xAccount.length === 0) {
    console.log(`❌ x_accountsテーブルにレコードが見つかりません: ${containerId}`);
    process.exit(1);
  }

  const current = xAccount[0];
  console.log('現在のメールアドレス情報:');
  console.log(`  email: ${current.email || '(空)'}`);
  console.log(`  email_password: ${current.email_password ? '***' : '(空)'}\n`);

  // 未使用のメールアドレスを取得（最も古いものから）
  const availableEmails = query<EmailAccount>(
    'SELECT * FROM email_accounts WHERE used_at IS NULL ORDER BY added_at ASC LIMIT 1'
  );

  if (availableEmails.length === 0) {
    console.log('❌ 未使用のメールアドレスが見つかりません');
    process.exit(1);
  }

  const emailAccount = availableEmails[0];
  const parsed = parseEmailPassword(emailAccount.email_password);

  if (!parsed) {
    console.log(`❌ メールアドレスの形式が不正です: ${emailAccount.email_password.substring(0, 50)}...`);
    process.exit(1);
  }

  console.log('取得したメールアドレス:');
  console.log(`  email: ${parsed.email}`);
  console.log(`  password: ${parsed.password.substring(0, 10)}...`);
  console.log(`  email_accounts.id: ${emailAccount.id}\n`);

  // x_accountsテーブルを更新
  const now = Date.now();
  run(
    'UPDATE x_accounts SET email = ?, email_password = ?, updated_at = ? WHERE container_id = ?',
    [parsed.email, parsed.password, now, containerId]
  );

  // email_accountsテーブルのused_atを更新
  run(
    'UPDATE email_accounts SET used_at = ? WHERE id = ?',
    [now, emailAccount.id]
  );

  console.log('✅ 更新完了');
  console.log(`  メールアドレス: ${parsed.email}`);
  console.log(`  email_accounts.used_at を更新しました\n`);

  // 確認
  const updated = query<{
    id: number;
    container_id: string;
    email: string | null;
    email_password: string | null;
  }>(
    'SELECT id, container_id, email, email_password FROM x_accounts WHERE container_id = ?',
    [containerId]
  );

  console.log('📊 更新後の状態:');
  console.log(`  id: ${updated[0].id}`);
  console.log(`  container_id: ${updated[0].container_id}`);
  console.log(`  email: ${updated[0].email || '(空)'}`);
  console.log(`  email_password: ${updated[0].email_password ? '***' : '(空)'}`);
}

main();
