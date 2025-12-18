import { initDb, query, run } from '../src/drivers/db';
import { enqueueTask } from '../src/services/taskQueue';

async function main() {
  initDb({ wal: true });
  
  const groupName = 'X兵隊12/5作成、プロフィール変更済';
  
  console.log(`グループ「${groupName}」からコンテナを取得します...\n`);
  
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
  
  // 既にメールアドレスが設定されているコンテナを除外して、未設定のコンテナを取得
  const xAccountsWithEmail = query<{container_id: string}>(
    'SELECT container_id FROM x_accounts WHERE email IS NOT NULL AND email != ?',
    ['']
  );
  const usedContainerIds = new Set(xAccountsWithEmail.map(acc => acc.container_id));
  
  console.log(`既にメールアドレスが設定されているコンテナ: ${usedContainerIds.size}件\n`);
  
  // 未設定のコンテナを探す
  let targetContainer = null;
  for (const member of members) {
    if (!usedContainerIds.has(member.container_id)) {
      targetContainer = member;
      break;
    }
  }
  
  // 未設定のコンテナが見つからない場合
  if (!targetContainer) {
    console.error('✗ 未設定のコンテナが見つかりませんでした');
    console.log('グループ内の全コンテナに既にメールアドレスが設定されています');
    process.exit(1);
  }
  
  const containerIdFromGroup = targetContainer.container_id;
  console.log(`対象コンテナID: ${containerIdFromGroup}\n`);
  
  // コンテナAPIからコンテナ情報を取得（コンテナ名を取得するため）
  console.log('コンテナ情報を取得します...\n');
  
  let containerName = containerIdFromGroup;
  try {
    const response = await fetch('http://localhost:5174/api/containers');
    if (response.ok) {
      const data = await response.json();
      if (data.items && Array.isArray(data.items)) {
        const container = data.items.find((c: any) => c.id === containerIdFromGroup);
        if (container) {
          containerName = container.name || container.id || containerIdFromGroup;
          console.log(`✓ コンテナ情報を取得: ${containerName} (ID: ${containerIdFromGroup})\n`);
        }
      }
    }
  } catch (e) {
    console.warn('コンテナAPIから情報を取得できませんでした。コンテナIDをそのまま使用します。\n');
  }
  
  // 未使用のメールアカウントを1件取得
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
  
  // Xアカウントテーブルにメールアドレスを設定
  console.log('Xアカウントテーブルにメールアドレスを設定します...\n');
  
  // コンテナIDまたはコンテナ名でXアカウントを検索
  let xAccounts = query<{id: number, container_id: string, email: string | null, x_password: string | null}>(
    'SELECT id, container_id, email, x_password FROM x_accounts WHERE container_id = ? OR container_id = ?',
    [containerIdFromGroup, containerName]
  );
  
  // 見つからない場合、コンテナ名の部分一致で検索
  if (!xAccounts || xAccounts.length === 0) {
    const allXAccounts = query<{id: number, container_id: string, email: string | null, x_password: string | null}>(
      'SELECT id, container_id, email, x_password FROM x_accounts'
    );
    console.log('Xアカウントテーブルの全コンテナID:');
    allXAccounts.forEach(acc => {
      console.log(`  - ${acc.container_id}`);
    });
    console.log('');
    
    // コンテナ名が含まれるXアカウントを検索
    xAccounts = allXAccounts.filter(acc => 
      acc.container_id.includes(containerName) || containerName.includes(acc.container_id)
    );
  }
  
  if (!xAccounts || xAccounts.length === 0) {
    console.error(`✗ コンテナ「${containerName}」または「${containerIdFromGroup}」に対応するXアカウントが見つかりませんでした`);
    console.log('Xアカウントテーブルに登録されているコンテナIDを確認してください');
    process.exit(1);
  }
  
  const xAccount = xAccounts[0];
  console.log(`✓ Xアカウントが見つかりました: ${xAccount.container_id}`);
  
  // Xアカウントのパスワードを確認
  if (!xAccount.x_password) {
    console.error('✗ Xアカウントのパスワード（x_password）が設定されていません');
    console.log('Xアカウントテーブルにパスワードを設定してください');
    process.exit(1);
  }
  
  // メールアドレスとパスワードを更新
  run(
    'UPDATE x_accounts SET email = ?, email_password = ? WHERE id = ?',
    [email, emailAccount.email_password, xAccount.id]
  );
  
  console.log(`✓ メールアドレスを設定しました: ${email}\n`);
  
  // メールアドレス変更のプリセットIDを確認（プリセット名から検索）
  console.log('メールアドレス変更のプリセットを検索します...\n');
  
  const presets = query<{id: number, name: string}>(
    'SELECT id, name FROM presets WHERE name LIKE ? OR name LIKE ?',
    ['%メール%', '%email%']
  );
  
  if (!presets || presets.length === 0) {
    console.error('✗ メールアドレス変更のプリセットが見つかりませんでした');
    console.log('利用可能なプリセット一覧:');
    const allPresets = query<{id: number, name: string}>('SELECT id, name FROM presets ORDER BY id');
    allPresets.forEach(p => {
      console.log(`  - ID: ${p.id}, 名前: ${p.name}`);
    });
    process.exit(1);
  }
  
  // メールアドレス変更に関連するプリセットを選択（最初に見つかったものを使用）
  const preset = presets[0];
  console.log(`✓ プリセットが見つかりました: ${preset.name} (ID: ${preset.id})\n`);
  
  // タスクを作成
  console.log('メールアドレス変更タスクを作成します...\n');
  
  // プリセットで使用されるパラメータ名に合わせて設定
  // - account_password: Xアカウントのパスワード
  // - new_email: 新しいメールアドレス
  // - email_credential: メール認証情報（形式: email:password）
  const runId = enqueueTask({
    presetId: preset.id,
    containerId: containerIdFromGroup,
    overrides: {
      account_password: xAccount.x_password,
      new_email: email,
      email_credential: emailAccount.email_password, // 形式: email:password
    },
    waitMinutes: 10,
  });
  
  console.log(`✓ タスクを作成しました`);
  console.log(`  Run ID: ${runId}`);
  console.log(`  コンテナ: ${containerName} (ID: ${containerIdFromGroup})`);
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

