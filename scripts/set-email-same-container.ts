import { initDb, query, run } from '../src/drivers/db';
import { enqueueTask } from '../src/services/taskQueue';

async function main() {
  initDb({ wal: true });
  
  // 最新のタスクからコンテナIDを取得
  const lastTask = query<{runId: string, container_id: string, overrides_json: string}>(
    'SELECT runId, container_id, overrides_json FROM tasks WHERE preset_id = 22 ORDER BY created_at DESC LIMIT 1'
  )[0];
  
  if (!lastTask) {
    console.error('✗ 前回のタスクが見つかりませんでした');
    process.exit(1);
  }
  
  const containerId = lastTask.container_id;
  const lastOverrides = lastTask.overrides_json ? JSON.parse(lastTask.overrides_json) : {};
  const lastEmail = lastOverrides.new_email || 'N/A';
  
  console.log(`前回のタスク情報:`);
  console.log(`  Run ID: ${lastTask.runId}`);
  console.log(`  コンテナID: ${containerId}`);
  console.log(`  使用したメール: ${lastEmail}\n`);
  
  // コンテナAPIからコンテナ情報を取得
  console.log('コンテナ情報を取得します...\n');
  
  let containerName = containerId;
  try {
    const response = await fetch('http://localhost:5174/api/containers');
    if (response.ok) {
      const data = await response.json();
      if (data.items && Array.isArray(data.items)) {
        const container = data.items.find((c: any) => c.id === containerId);
        if (container) {
          containerName = container.name || container.id || containerId;
          console.log(`✓ コンテナ情報を取得: ${containerName} (ID: ${containerId})\n`);
        }
      }
    }
  } catch (e) {
    console.warn('コンテナAPIから情報を取得できませんでした。コンテナIDをそのまま使用します。\n');
  }
  
  // 未使用のメールアカウントを1件取得（前回使用したメールは除外）
  console.log('未使用のメールアカウントを取得します...\n');
  
  const emailAccounts = query<{id: number, email_password: string, added_at: number}>(
    'SELECT * FROM email_accounts WHERE used_at IS NULL ORDER BY added_at ASC LIMIT 1'
  );
  
  if (!emailAccounts || emailAccounts.length === 0) {
    console.error('✗ 未使用のメールアカウントが見つかりませんでした');
    process.exit(1);
  }
  
  const emailAccount = emailAccounts[0];
  const [email, password] = emailAccount.email_password.split(':');
  
  console.log(`✓ メールアカウントを取得: ${email}`);
  console.log(`  パスワード: ${password.substring(0, 3)}...\n`);
  
  // Xアカウントテーブルを更新（同じコンテナに対して新しいメールアドレスを設定）
  console.log('Xアカウントテーブルにメールアドレスを更新します...\n');
  
  // コンテナIDまたはコンテナ名でXアカウントを検索
  let xAccounts = query<{id: number, container_id: string, email: string | null, x_password: string | null}>(
    'SELECT id, container_id, email, x_password FROM x_accounts WHERE container_id = ? OR container_id = ?',
    [containerId, containerName]
  );
  
  // 見つからない場合、コンテナ名の部分一致で検索
  if (!xAccounts || xAccounts.length === 0) {
    const allXAccounts = query<{id: number, container_id: string, email: string | null, x_password: string | null}>(
      'SELECT id, container_id, email, x_password FROM x_accounts'
    );
    
    // コンテナ名が含まれるXアカウントを検索
    xAccounts = allXAccounts.filter(acc => 
      acc.container_id.includes(containerName) || containerName.includes(acc.container_id)
    );
  }
  
  if (!xAccounts || xAccounts.length === 0) {
    console.error(`✗ コンテナ「${containerName}」または「${containerId}」に対応するXアカウントが見つかりませんでした`);
    process.exit(1);
  }
  
  const xAccount = xAccounts[0];
  console.log(`✓ Xアカウントが見つかりました: ${xAccount.container_id}`);
  
  // Xアカウントのパスワードを確認
  if (!xAccount.x_password) {
    console.error('✗ Xアカウントのパスワード（x_password）が設定されていません');
    process.exit(1);
  }
  
  // メールアドレスとパスワードを更新
  run(
    'UPDATE x_accounts SET email = ?, email_password = ? WHERE id = ?',
    [email, emailAccount.email_password, xAccount.id]
  );
  
  console.log(`✓ メールアドレスを更新しました: ${email}\n`);
  
  // メールアドレス変更のプリセットIDを確認
  console.log('メールアドレス変更のプリセットを検索します...\n');
  
  const presets = query<{id: number, name: string}>(
    'SELECT id, name FROM presets WHERE name LIKE ? OR name LIKE ?',
    ['%メール%', '%email%']
  );
  
  if (!presets || presets.length === 0) {
    console.error('✗ メールアドレス変更のプリセットが見つかりませんでした');
    process.exit(1);
  }
  
  const preset = presets[0];
  console.log(`✓ プリセットが見つかりました: ${preset.name} (ID: ${preset.id})\n`);
  
  // タスクを作成
  console.log('メールアドレス変更タスクを作成します...\n');
  
  const runId = enqueueTask({
    presetId: preset.id,
    containerId: containerId,
    overrides: {
      account_password: xAccount.x_password,
      new_email: email,
      email_credential: emailAccount.email_password, // 形式: email:password
    },
    waitMinutes: 10,
  });
  
  console.log(`✓ タスクを作成しました`);
  console.log(`  Run ID: ${runId}`);
  console.log(`  コンテナ: ${containerName} (ID: ${containerId})`);
  console.log(`  メールアドレス: ${email}`);
  console.log(`  プリセット: ${preset.name} (ID: ${preset.id})\n`);
  
  // メールアカウントを使用済みにマーク
  console.log('メールアカウントを使用済みにマークします...\n');
  
  run(
    'UPDATE email_accounts SET used_at = ? WHERE id = ?',
    [Date.now(), emailAccount.id]
  );
  
  console.log(`✓ メールアカウントを使用済みにマークしました\n`);
  
  console.log('--- 処理完了 ---');
  console.log(`✓ メールアドレス: ${email}`);
  console.log(`✓ Xアカウント: ${xAccount.container_id}`);
  console.log(`✓ タスク作成: ${runId}`);
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

