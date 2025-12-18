import { initDb, query, run } from '../src/drivers/db';
import { enqueueTask } from '../src/services/taskQueue';

async function main() {
  initDb({ wal: true });
  
  const groupName = 'X兵隊12/7作成、プロフィール変更済';
  
  console.log(`グループ「${groupName}」のパスワード設定を確認し、メールアドレス変更タスクを作成します...\n`);
  
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
  
  // コンテナAPIからコンテナ情報を取得（コンテナ名を取得するため）
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
  
  // 1時間後のタイムスタンプを計算
  const oneHourLater = Date.now() + 60 * 60 * 1000;
  const scheduledAt = oneHourLater;
  console.log(`✓ タスクの実行予定時刻: ${new Date(scheduledAt).toLocaleString('ja-JP')}\n`);
  
  // 各コンテナに対してパスワードを確認し、タスクを作成
  const results: Array<{containerId: string, containerName: string, email: string, runId: string}> = [];
  const skipped: Array<{containerId: string, containerName: string, reason: string}> = [];
  
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const containerId = member.container_id;
    const containerName = containerMap[containerId] || containerId;
    
    console.log(`[${i + 1}/${members.length}] コンテナ: ${containerName} (ID: ${containerId})`);
    
    // Xアカウントを検索
    let xAccounts = query<{id: number, container_id: string, email: string | null, email_password: string | null, x_password: string | null}>(
      'SELECT id, container_id, email, email_password, x_password FROM x_accounts WHERE container_id = ? OR container_id = ?',
      [containerId, containerName]
    );
    
    // 見つからない場合、コンテナ名の部分一致で検索
    if (!xAccounts || xAccounts.length === 0) {
      const allXAccounts = query<{id: number, container_id: string, email: string | null, email_password: string | null, x_password: string | null}>(
        'SELECT id, container_id, email, email_password, x_password FROM x_accounts'
      );
      xAccounts = allXAccounts.filter(acc => 
        acc.container_id.includes(containerName) || containerName.includes(acc.container_id)
      );
    }
    
    if (!xAccounts || xAccounts.length === 0) {
      console.log(`  ✗ Xアカウントが見つかりませんでした。スキップします。\n`);
      skipped.push({ containerId, containerName, reason: 'Xアカウントが見つからない' });
      continue;
    }
    
    const xAccount = xAccounts[0];
    
    // パスワードが設定されているか確認
    if (!xAccount.x_password || xAccount.x_password.trim() === '') {
      console.log(`  ✗ Xアカウントのパスワード（x_password）が設定されていません。スキップします。\n`);
      skipped.push({ containerId, containerName, reason: 'パスワードが設定されていない' });
      continue;
    }
    
    // メールアドレスが設定されているか確認
    if (!xAccount.email || xAccount.email.trim() === '') {
      console.log(`  ✗ メールアドレスが設定されていません。スキップします。\n`);
      skipped.push({ containerId, containerName, reason: 'メールアドレスが設定されていない' });
      continue;
    }
    
    if (!xAccount.email_password || xAccount.email_password.trim() === '') {
      console.log(`  ✗ メールパスワード（email_password）が設定されていません。スキップします。\n`);
      skipped.push({ containerId, containerName, reason: 'メールパスワードが設定されていない' });
      continue;
    }
    
    console.log(`  ✓ パスワード確認済み`);
    console.log(`  メール: ${xAccount.email}`);
    
    // タスクを作成（1時間後、queue2に登録）
    const runId = enqueueTask(
      {
        presetId: preset.id,
        containerId: containerId,
        overrides: {
          account_password: xAccount.x_password,
          new_email: xAccount.email,
          email_credential: xAccount.email_password, // 形式: email:password
        },
        scheduledAt: scheduledAt,
        waitMinutes: 10,
      },
      'queue2' // タスク2キューに登録
    );
    
    results.push({
      containerId,
      containerName,
      email: xAccount.email,
      runId,
    });
    
    console.log(`  ✓ タスク作成: ${runId} (queue2, 1時間後)\n`);
  }
  
  // 結果をまとめて表示
  console.log('--- 処理完了 ---');
  console.log(`作成したタスク数: ${results.length}件`);
  console.log(`スキップしたコンテナ数: ${skipped.length}件\n`);
  
  if (results.length > 0) {
    console.log('作成したタスク:');
    results.forEach((r, i) => {
      console.log(`${i + 1}. ${r.containerName} (${r.containerId})`);
      console.log(`   メール: ${r.email}`);
      console.log(`   タスク: ${r.runId} (queue2, 1時間後)\n`);
    });
  }
  
  if (skipped.length > 0) {
    console.log('スキップしたコンテナ:');
    skipped.forEach((s, i) => {
      console.log(`${i + 1}. ${s.containerName} (${s.containerId})`);
      console.log(`   理由: ${s.reason}\n`);
    });
  }
  
  process.exit(0);
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

