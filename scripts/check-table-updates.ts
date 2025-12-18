import { initDb, query } from '../src/drivers/db';

async function main() {
  initDb({ wal: true });
  
  // 最新のタスクを確認
  console.log('=== 最新のタスク（メール変更）===\n');
  const recentTasks = query<{runId: string, container_id: string, overrides_json: string, created_at: number, scheduled_at: number | null}>(
    'SELECT runId, container_id, overrides_json, created_at, scheduled_at FROM tasks WHERE preset_id = 22 ORDER BY created_at DESC LIMIT 5'
  );
  
  recentTasks.forEach((t, i) => {
    const overrides = t.overrides_json ? JSON.parse(t.overrides_json) : {};
    console.log(`${i + 1}. Run ID: ${t.runId}`);
    console.log(`   コンテナID: ${t.container_id}`);
    console.log(`   メール: ${overrides.new_email || 'N/A'}`);
    console.log(`   作成日時: ${new Date(t.created_at).toLocaleString('ja-JP')}`);
    if (t.scheduled_at) {
      console.log(`   予定時刻: ${new Date(t.scheduled_at).toLocaleString('ja-JP')}`);
    } else {
      console.log(`   予定時刻: 即時実行`);
    }
    console.log('');
  });
  
  // Xアカウントテーブルでメールアドレスが設定されているコンテナを確認
  console.log('=== Xアカウントテーブル（メールアドレス設定済み）===\n');
  const xAccountsWithEmail = query<{container_id: string, email: string, email_password: string}>(
    'SELECT container_id, email, email_password FROM x_accounts WHERE email IS NOT NULL AND email != ? ORDER BY container_id',
    ['']
  );
  
  console.log(`メールアドレス設定済み: ${xAccountsWithEmail.length}件\n`);
  
  // 最新のタスクのコンテナIDと照合
  const recentContainerIds = new Set(recentTasks.map(t => t.container_id));
  const matchedAccounts = xAccountsWithEmail.filter(acc => recentContainerIds.has(acc.container_id));
  
  if (matchedAccounts.length > 0) {
    console.log('最新のタスクに対応するXアカウント:');
    matchedAccounts.forEach(acc => {
      const email = acc.email_password.split(':')[0];
      console.log(`  ${acc.container_id}: ${email}`);
    });
    console.log('');
  }
  
  // メールアカウントテーブルで使用済みの件数を確認
  console.log('=== メールアカウントテーブル ===\n');
  const usedEmailCount = query<{count: number}>(
    'SELECT COUNT(*) as count FROM email_accounts WHERE used_at IS NOT NULL'
  )[0];
  const unusedEmailCount = query<{count: number}>(
    'SELECT COUNT(*) as count FROM email_accounts WHERE used_at IS NULL'
  )[0];
  
  console.log(`使用済み: ${usedEmailCount.count}件`);
  console.log(`未使用: ${unusedEmailCount.count}件\n`);
  
  // 最新のタスクで使用されたメールアドレスを確認
  const recentEmails = recentTasks
    .map(t => {
      const overrides = t.overrides_json ? JSON.parse(t.overrides_json) : {};
      return overrides.new_email;
    })
    .filter(Boolean);
  
  if (recentEmails.length > 0) {
    console.log('最新のタスクで使用されたメールアドレス:');
    recentEmails.forEach(email => {
      const emailAccount = query<{id: number, email_password: string, used_at: number | null}>(
        'SELECT id, email_password, used_at FROM email_accounts WHERE email_password LIKE ?',
        [`${email}:%`]
      )[0];
      
      if (emailAccount) {
        console.log(`  ${email}: ${emailAccount.used_at ? '使用済み ✓' : '未使用 ✗'}`);
      } else {
        console.log(`  ${email}: 見つかりませんでした`);
      }
    });
  }
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

