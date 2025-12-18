import { initDb, query } from '../src/drivers/db';

async function main() {
  initDb({ wal: true });
  
  // 最新の4件のタスクを取得
  const recentTasks = query<{runId: string, container_id: string, overrides_json: string}>(
    'SELECT runId, container_id, overrides_json FROM tasks WHERE preset_id = 22 ORDER BY created_at DESC LIMIT 4'
  );
  
  console.log('=== 最新4件のタスクとXアカウントテーブルの照合 ===\n');
  
  let allMatched = true;
  
  for (const task of recentTasks) {
    const overrides = task.overrides_json ? JSON.parse(task.overrides_json) : {};
    const email = overrides.new_email || 'N/A';
    
    console.log(`タスク: ${task.runId}`);
    console.log(`  コンテナID: ${task.container_id}`);
    console.log(`  メール: ${email}`);
    
    // Xアカウントテーブルを確認
    const xAccount = query<{id: number, container_id: string, email: string | null, email_password: string | null}>(
      'SELECT id, container_id, email, email_password FROM x_accounts WHERE container_id = ?',
      [task.container_id]
    )[0];
    
    if (xAccount) {
      const xEmail = xAccount.email_password ? xAccount.email_password.split(':')[0] : xAccount.email;
      if (xEmail === email) {
        console.log(`  ✓ Xアカウントテーブル: メールアドレスが正しく設定されています`);
      } else {
        console.log(`  ✗ Xアカウントテーブル: メールアドレスが不一致`);
        console.log(`    期待値: ${email}`);
        console.log(`    実際の値: ${xEmail || '未設定'}`);
        allMatched = false;
      }
    } else {
      console.log(`  ✗ Xアカウントテーブル: コンテナが見つかりませんでした`);
      allMatched = false;
    }
    console.log('');
  }
  
  if (allMatched) {
    console.log('✓ すべてのタスクでXアカウントテーブルが正しく更新されています');
  } else {
    console.log('✗ 一部のタスクでXアカウントテーブルの更新に問題があります');
  }
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

