/**
 * 登録済みXアカウントから残りのアカウントに対してログインタスクを作成するスクリプト
 * 
 * 処理内容:
 * 1. x_accountsテーブルから全アカウントを取得
 * 2. 既にタスクが作成されているアカウントを除外
 * 3. 残りのアカウントに対してプリセット17（X Authログイン）のタスクを作成
 * 
 * 重要: container_idについて
 * - x_accountsテーブルのcontainer_idはUUID形式（例: 7382f210-bda5-4fbb-9d95-783074a84f32）である必要があります
 * - 名前形式（例: infoborne113558）の場合は、Container Browser APIでエラーが発生します
 * - 名前形式のcontainer_idが存在する場合は、事前に scripts/update-container-ids-to-uuid.ts を実行してUUID形式に変換してください
 * 
 * 使用方法:
 *   npx tsx scripts/create-remaining-login-tasks.ts
 */

import { initDb, query } from '../src/drivers/db';
import { enqueueTask } from '../src/services/taskQueue';

interface XAccount {
  container_id: string;
  auth_token: string | null;
  ct0: string | null;
  proxy_id: number | null;
}

interface ProxyInfo {
  id: number;
  proxy_info: string;
}

interface ExistingTask {
  overrides_json: string;
}

/**
 * 既にタスクが作成されているアカウントのcontainer_nameを取得
 */
function getExistingTaskContainerNames(): Set<string> {
  const tasks = query<ExistingTask>(
    `SELECT overrides_json FROM tasks WHERE preset_id = 17`,
    []
  );
  const containerNames = new Set<string>();
  
  for (const task of tasks || []) {
    try {
      const overrides = JSON.parse(task.overrides_json || '{}');
      if (overrides.container_name) {
        containerNames.add(String(overrides.container_name));
      }
    } catch (e) {
      // JSON解析エラーは無視
    }
  }
  
  return containerNames;
}

/**
 * 全アカウントを取得
 */
function getAllXAccounts(): XAccount[] {
  return query<XAccount>(
    'SELECT container_id, auth_token, ct0, proxy_id FROM x_accounts ORDER BY created_at DESC',
    []
  );
}

/**
 * プロキシ情報を取得
 */
function getProxyInfo(proxyId: number | null): string | null {
  if (!proxyId) {
    return null;
  }
  const proxies = query<ProxyInfo>(
    'SELECT id, proxy_info FROM proxies WHERE id = ? LIMIT 1',
    [proxyId]
  );
  if (proxies && proxies.length > 0) {
    return proxies[0].proxy_info;
  }
  return null;
}

/**
 * ログインタスクを作成
 * 
 * 注意: container_nameはUUID形式である必要があります
 * - 名前形式（例: infoborne113558）の場合は、Container Browser APIでエラーが発生します
 * - x_accountsテーブルのcontainer_idは既にUUID形式に更新されているため、そのまま使用します
 */
function createLoginTask(account: XAccount, proxyInfo: string | null): string | null {
  try {
    // container_idがUUID形式か確認（念のため）
    const isUuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account.container_id);
    if (!isUuidFormat) {
      console.warn(`  ⚠ container_idがUUID形式ではありません: ${account.container_id}`);
      console.warn(`     scripts/update-container-ids-to-uuid.ts を実行してUUID形式に変換してください`);
      return null;
    }

    const runId = enqueueTask({
      presetId: 17, // X Authログイン
      containerId: null, // コンテナ作成ステップがあるためnull
      overrides: {
        container_name: account.container_id, // UUID形式のcontainer_idを使用
        auth_token: account.auth_token,
        ct0: account.ct0,
        proxy: proxyInfo || '',
      },
      waitMinutes: 10,
    });
    return runId;
  } catch (e: any) {
    console.error(`タスク作成エラー: ${account.container_id} - ${e?.message || String(e)}`);
    return null;
  }
}

function main() {
  // データベース初期化
  initDb({ wal: true });

  console.log('🔍 アカウント情報を取得中...\n');

  // 既存のタスクを確認
  const existingContainerNames = getExistingTaskContainerNames();
  console.log(`既存タスク数: ${existingContainerNames.size}件\n`);

  // 全アカウントを取得
  const allAccounts = getAllXAccounts();
  console.log(`登録済みアカウント数: ${allAccounts.length}件\n`);

  // 未作成のアカウントをフィルタ
  const accountsToProcess = allAccounts.filter(account => 
    !existingContainerNames.has(account.container_id)
  );

  console.log(`タスク作成対象: ${accountsToProcess.length}件\n`);

  if (accountsToProcess.length === 0) {
    console.log('✓ すべてのアカウントに対してタスクが既に作成されています');
    return;
  }

  // 統計情報
  let success = 0;
  let skipped = 0;
  let errors = 0;

  // 各アカウントに対してタスクを作成
  for (let i = 0; i < accountsToProcess.length; i++) {
    const account = accountsToProcess[i];
    console.log(`[${i + 1}/${accountsToProcess.length}] 処理中: ${account.container_id}...`);

    // 必須情報のチェック
    if (!account.auth_token) {
      console.warn(`  ⚠ auth_tokenが設定されていません（スキップ）`);
      skipped++;
      continue;
    }
    if (!account.ct0) {
      console.warn(`  ⚠ ct0が設定されていません（スキップ）`);
      skipped++;
      continue;
    }

    // プロキシ情報を取得
    const proxyInfo = getProxyInfo(account.proxy_id);

    // タスクを作成
    const runId = createLoginTask(account, proxyInfo);
    if (runId) {
      success++;
      console.log(`  ✓ タスク作成完了 (Run ID: ${runId})`);
    } else {
      errors++;
      console.error(`  ✗ タスク作成失敗`);
    }

    console.log('');
  }

  // 結果サマリ
  console.log('='.repeat(60));
  console.log('📊 処理結果サマリ');
  console.log('='.repeat(60));
  console.log(`処理対象: ${accountsToProcess.length}件`);
  console.log(`✓ タスク作成成功: ${success}件`);
  console.log(`⊘ スキップ（情報不足）: ${skipped}件`);
  console.log(`✗ エラー: ${errors}件`);
  console.log('='.repeat(60));
  console.log('\n💡 ダッシュボード（http://localhost:5174）でタスクの実行状況を確認できます');

  if (errors > 0) {
    process.exit(1);
  }
}

main();


