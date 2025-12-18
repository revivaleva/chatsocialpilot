import { initDb, query, run } from '../src/drivers/db';

async function main() {
  initDb({ wal: true });
  
  // 最新の4件のタスクを取得
  const recentTasks = query<{runId: string, container_id: string, overrides_json: string}>(
    'SELECT runId, container_id, overrides_json FROM tasks WHERE preset_id = 22 ORDER BY created_at DESC LIMIT 4'
  );
  
  console.log('=== Xアカウントテーブルを更新します ===\n');
  
  // コンテナAPIからコンテナ情報を取得
  let containerMap: Record<string, string> = {};
  try {
    const response = await fetch('http://localhost:5174/api/containers');
    if (response.ok) {
      const data = await response.json();
      if (data.items && Array.isArray(data.items)) {
        data.items.forEach((c: any) => {
          if (c.id) {
            containerMap[c.id] = c.name || c.id;
          }
        });
      }
    }
  } catch (e) {
    console.warn('コンテナAPIから情報を取得できませんでした。\n');
  }
  
  let updatedCount = 0;
  
  for (const task of recentTasks) {
    const overrides = task.overrides_json ? JSON.parse(task.overrides_json) : {};
    const email = overrides.new_email;
    const emailCredential = overrides.email_credential; // email:password形式
    
    if (!email || !emailCredential) {
      console.log(`タスク ${task.runId}: メール情報が不足しています。スキップします。\n`);
      continue;
    }
    
    const containerId = task.container_id;
    const containerName = containerMap[containerId] || containerId;
    
    console.log(`タスク: ${task.runId.substring(0, 30)}...`);
    console.log(`  コンテナID: ${containerId}`);
    console.log(`  コンテナ名: ${containerName}`);
    console.log(`  メール: ${email}`);
    
    // Xアカウントを検索（コンテナIDまたはコンテナ名で）
    let xAccounts = query<{id: number, container_id: string, email: string | null, x_password: string | null}>(
      'SELECT id, container_id, email, x_password FROM x_accounts WHERE container_id = ? OR container_id = ?',
      [containerId, containerName]
    );
    
    if (!xAccounts || xAccounts.length === 0) {
      console.log(`  ✗ Xアカウントが見つかりませんでした。スキップします。\n`);
      continue;
    }
    
    const xAccount = xAccounts[0];
    
    // Xアカウントテーブルを更新
    run(
      'UPDATE x_accounts SET email = ?, email_password = ? WHERE id = ?',
      [email, emailCredential, xAccount.id]
    );
    
    console.log(`  ✓ Xアカウントテーブルを更新しました (ID: ${xAccount.id})\n`);
    updatedCount++;
  }
  
  console.log(`--- 処理完了 ---`);
  console.log(`更新したXアカウント: ${updatedCount}件`);
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

