import { initDb, query, run } from '../src/drivers/db';
import { enqueueTask } from '../src/services/taskQueue';

async function main() {
  initDb({ wal: true });
  
  const groupName = 'X兵隊12/6作成、プロフィール変更済';
  
  console.log(`グループ「${groupName}」から全コンテナのタスクを作成します...\n`);
  
  // グループIDを取得
  const groups = query<{id: string, name: string}>(
    'SELECT id, name FROM container_groups WHERE name = ?',
    [groupName]
  );
  
  if (!groups || groups.length === 0) {
    console.error(`✗ グループ「${groupName}」が見つかりませんでした`);
    process.exit(1);
  }
  
  const group = groups[0];
  console.log(`✓ グループが見つかりました: ${group.name} (ID: ${group.id})\n`);
  
  // グループに属するコンテナを取得
  const members = query<{container_id: string}>(
    'SELECT container_id FROM container_group_members WHERE group_id = ?',
    [group.id]
  );
  
  if (!members || members.length === 0) {
    console.error(`✗ グループに属するコンテナが見つかりませんでした`);
    process.exit(1);
  }
  
  console.log(`✓ グループ内のコンテナ数: ${members.length}件\n`);
  
  // 既にメールアドレスが設定されているコンテナを除外
  const xAccountsWithEmail = query<{container_id: string}>(
    'SELECT container_id FROM x_accounts WHERE email IS NOT NULL AND email != ?',
    ['']
  );
  const usedContainerIds = new Set(xAccountsWithEmail.map(acc => acc.container_id));
  
  console.log(`既にメールアドレスが設定されているコンテナ: ${usedContainerIds.size}件\n`);
  
  // 未設定のコンテナを取得
  const availableContainers = members.filter(member => !usedContainerIds.has(member.container_id));
  
  if (availableContainers.length === 0) {
    console.error('✗ 未設定のコンテナが見つかりませんでした');
    console.log('グループ内の全コンテナに既にメールアドレスが設定されています');
    process.exit(1);
  }
  
  console.log(`対象コンテナ数: ${availableContainers.length}件\n`);
  
  // コンテナAPIからコンテナ情報を取得
  console.log('コンテナ情報を取得します...\n');
  
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
    console.warn('コンテナAPIから情報を取得できませんでした。コンテナIDをそのまま使用します。\n');
  }
  
  // 未使用のメールアカウントを取得（必要な数だけ）
  console.log('未使用のメールアカウントを取得します...\n');
  
  const emailAccounts = query<{id: number, email_password: string, added_at: number}>(
    'SELECT * FROM email_accounts WHERE used_at IS NULL ORDER BY added_at ASC LIMIT ?',
    [availableContainers.length]
  );
  
  if (!emailAccounts || emailAccounts.length < availableContainers.length) {
    console.error(`✗ 未使用のメールアカウントが不足しています（必要: ${availableContainers.length}件、利用可能: ${emailAccounts?.length || 0}件）`);
    process.exit(1);
  }
  
  console.log(`✓ ${emailAccounts.length}件のメールアカウントを取得しました\n`);
  
  // メールアドレス変更のプリセットIDを確認
  const presets = query<{id: number, name: string}>(
    'SELECT id, name FROM presets WHERE name LIKE ? OR name LIKE ?',
    ['%メール%', '%email%']
  );
  
  if (!presets || presets.length === 0) {
    console.error('✗ メールアドレス変更のプリセットが見つかりませんでした');
    process.exit(1);
  }
  
  const preset = presets[0];
  console.log(`✓ プリセット: ${preset.name} (ID: ${preset.id})\n`);
  
  // 各コンテナに対してタスクを作成
  const results: Array<{containerId: string, containerName: string, email: string, runId: string}> = [];
  
  for (let i = 0; i < availableContainers.length; i++) {
    const container = availableContainers[i];
    const containerId = container.container_id;
    const containerName = containerMap[containerId] || containerId;
    const emailAccount = emailAccounts[i];
    const [email, password] = emailAccount.email_password.split(':');
    
    console.log(`[${i + 1}/${availableContainers.length}] コンテナ: ${containerName} (ID: ${containerId})`);
    console.log(`  メール: ${email}`);
    
    // Xアカウントを検索
    let xAccounts = query<{id: number, container_id: string, email: string | null, x_password: string | null}>(
      'SELECT id, container_id, email, x_password FROM x_accounts WHERE container_id = ? OR container_id = ?',
      [containerId, containerName]
    );
    
    if (!xAccounts || xAccounts.length === 0) {
      const allXAccounts = query<{id: number, container_id: string, email: string | null, x_password: string | null}>(
        'SELECT id, container_id, email, x_password FROM x_accounts'
      );
      xAccounts = allXAccounts.filter(acc => 
        acc.container_id.includes(containerName) || containerName.includes(acc.container_id)
      );
    }
    
    if (!xAccounts || xAccounts.length === 0) {
      console.log(`  ✗ Xアカウントが見つかりませんでした。スキップします。\n`);
      continue;
    }
    
    const xAccount = xAccounts[0];
    
    if (!xAccount.x_password) {
      console.log(`  ✗ Xアカウントのパスワードが設定されていません。スキップします。\n`);
      continue;
    }
    
    // Xアカウントテーブルにメールアドレスを設定
    run(
      'UPDATE x_accounts SET email = ?, email_password = ? WHERE id = ?',
      [email, emailAccount.email_password, xAccount.id]
    );
    
    // タスクを作成（即時実行）
    const runId = enqueueTask({
      presetId: preset.id,
      containerId: containerId,
      overrides: {
        account_password: xAccount.x_password,
        new_email: email,
        email_credential: emailAccount.email_password,
      },
      waitMinutes: 10,
    });
    
    // メールアカウントを使用済みにマーク
    run(
      'UPDATE email_accounts SET used_at = ? WHERE id = ?',
      [Date.now(), emailAccount.id]
    );
    
    results.push({
      containerId,
      containerName,
      email,
      runId,
    });
    
    console.log(`  ✓ タスク作成: ${runId}`);
    console.log(`  ✓ Xアカウントテーブル更新: ${xAccount.id}\n`);
  }
  
  // 結果をまとめて表示
  console.log('--- 処理完了 ---');
  console.log(`作成したタスク数: ${results.length}件\n`);
  
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.containerName} (${r.containerId})`);
    console.log(`   メール: ${r.email}`);
    console.log(`   タスク: ${r.runId}\n`);
  });
  
  process.exit(0);
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

