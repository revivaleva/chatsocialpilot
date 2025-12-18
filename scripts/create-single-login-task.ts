/**
 * 登録済みXアカウントから1件を取得してログインタスクを作成するスクリプト
 * 
 * 処理内容:
 * 1. x_accountsテーブルから最新のアカウントを1件取得
 * 2. プロキシ情報を取得（proxy_idから）
 * 3. プリセット17（X Authログイン）のタスクを作成
 * 
 * 重要: container_idについて
 * - x_accountsテーブルのcontainer_idはUUID形式（例: 7382f210-bda5-4fbb-9d95-783074a84f32）である必要があります
 * - 名前形式（例: infoborne113558）の場合は、Container Browser APIでエラーが発生します
 * - 名前形式のcontainer_idが存在する場合は、事前に scripts/update-container-ids-to-uuid.ts を実行してUUID形式に変換してください
 * 
 * 使用方法:
 *   npx tsx scripts/create-single-login-task.ts
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

function getLatestXAccount(): XAccount | null {
  const accounts = query<XAccount>(
    'SELECT container_id, auth_token, ct0, proxy_id FROM x_accounts ORDER BY created_at DESC LIMIT 1',
    []
  );
  if (accounts && accounts.length > 0) {
    return accounts[0];
  }
  return null;
}

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

function main() {
  // データベース初期化
  initDb({ wal: true });

  console.log('🔍 最新のXアカウントを取得中...\n');

  // 最新のアカウントを取得
  const account = getLatestXAccount();
  if (!account) {
    console.error('❌ x_accountsテーブルにアカウントが見つかりません');
    process.exit(1);
  }

  console.log(`✓ アカウントを取得: ${account.container_id}`);

  // 必須情報のチェック
  if (!account.auth_token) {
    console.error(`❌ auth_tokenが設定されていません: ${account.container_id}`);
    process.exit(1);
  }
  if (!account.ct0) {
    console.error(`❌ ct0が設定されていません: ${account.container_id}`);
    process.exit(1);
  }

  // プロキシ情報を取得
  const proxyInfo = getProxyInfo(account.proxy_id);
  if (!proxyInfo) {
    console.warn(`⚠ プロキシ情報が見つかりません（プロキシなしで続行）`);
  } else {
    console.log(`✓ プロキシ情報を取得: ${proxyInfo}`);
  }

  // container_idがUUID形式か確認（念のため）
  const isUuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account.container_id);
  if (!isUuidFormat) {
    console.error(`❌ container_idがUUID形式ではありません: ${account.container_id}`);
    console.error(`   scripts/update-container-ids-to-uuid.ts を実行してUUID形式に変換してください`);
    process.exit(1);
  }

  console.log('\n📝 ログインタスクを作成中...\n');

  try {
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

    console.log('='.repeat(60));
    console.log('✓ タスク作成成功');
    console.log('='.repeat(60));
    console.log(`Run ID: ${runId}`);
    console.log(`コンテナ名: ${account.container_id}`);
    console.log(`プロキシ: ${proxyInfo || 'なし'}`);
    console.log('='.repeat(60));
    console.log('\n💡 ダッシュボード（http://localhost:5174）でタスクの実行状況を確認できます');
  } catch (e: any) {
    console.error('❌ タスク作成エラー:', e?.message || String(e));
    process.exit(1);
  }
}

main();


