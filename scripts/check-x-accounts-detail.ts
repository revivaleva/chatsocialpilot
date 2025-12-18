import { initDb, query } from '../src/drivers/db';

async function main() {
  initDb({ wal: true });
  
  // 最新の4件のタスクを取得
  const recentTasks = query<{runId: string, container_id: string, overrides_json: string}>(
    'SELECT runId, container_id, overrides_json FROM tasks WHERE preset_id = 22 ORDER BY created_at DESC LIMIT 4'
  );
  
  console.log('=== Xアカウントテーブルの全データ確認 ===\n');
  
  // Xアカウントテーブルの全データを取得
  const allXAccounts = query<{id: number, container_id: string, email: string | null, email_password: string | null}>(
    'SELECT id, container_id, email, email_password FROM x_accounts ORDER BY id DESC LIMIT 20'
  );
  
  console.log(`Xアカウントテーブルの最新20件:`);
  allXAccounts.forEach(acc => {
    const email = acc.email_password ? acc.email_password.split(':')[0] : acc.email || '未設定';
    console.log(`  ${acc.container_id}: ${email}`);
  });
  console.log('');
  
  // 最新のタスクのコンテナIDと照合
  console.log('=== 最新4件のタスクとの照合 ===\n');
  
  for (const task of recentTasks) {
    const overrides = task.overrides_json ? JSON.parse(task.overrides_json) : {};
    const email = overrides.new_email || 'N/A';
    
    console.log(`タスク: ${task.runId.substring(0, 30)}...`);
    console.log(`  コンテナID: ${task.container_id}`);
    console.log(`  メール: ${email}`);
    
    // 完全一致で検索
    let xAccount = allXAccounts.find(acc => acc.container_id === task.container_id);
    
    // 見つからない場合、コンテナ名で検索（コンテナAPIから取得）
    if (!xAccount) {
      try {
        const response = await fetch('http://localhost:5174/api/containers');
        if (response.ok) {
          const data = await response.json();
          if (data.items && Array.isArray(data.items)) {
            const container = data.items.find((c: any) => c.id === task.container_id);
            if (container && container.name) {
              // コンテナ名で検索
              xAccount = allXAccounts.find(acc => acc.container_id === container.name);
              if (xAccount) {
                console.log(`  → コンテナ名「${container.name}」で見つかりました`);
              }
            }
          }
        }
      } catch (e) {
        // エラーは無視
      }
    }
    
    if (xAccount) {
      const xEmail = xAccount.email_password ? xAccount.email_password.split(':')[0] : xAccount.email || '未設定';
      if (xEmail === email) {
        console.log(`  ✓ Xアカウントテーブル: メールアドレスが正しく設定されています`);
      } else {
        console.log(`  ✗ Xアカウントテーブル: メールアドレスが不一致`);
        console.log(`    期待値: ${email}`);
        console.log(`    実際の値: ${xEmail}`);
      }
    } else {
      console.log(`  ✗ Xアカウントテーブル: コンテナが見つかりませんでした`);
      console.log(`    → テーブル更新が必要です`);
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

