/**
 * Xアカウントを登録し、コンテナを作成してログインタスクを作成するスクリプト
 * 
 * 処理内容:
 * 1. x_accountsテーブルからauth_tokenとct0がNULLのアカウントを取得
 * 2. 各アカウントに対してコンテナを作成
 * 3. パスワードログインプリセットでログインタスクを作成
 * 
 * 使用方法:
 *   npx tsx scripts/create-containers-and-login-tasks.ts [presetId]
 * 
 * 注意:
 *   - presetIdを指定しない場合、プリセット名「X パスワードログイン」を検索して使用します
 */

import { initDb, query } from '../src/drivers/db';
import { enqueueTask } from '../src/services/taskQueue';
import { getPreset, listPresets } from '../src/services/presets';
import { createContainer } from '../src/drivers/browser';

interface XAccount {
  container_id: string;
  x_password: string;
  twofa_code: string | null;
  email: string | null;
  proxy_id: number | null;
}

interface ProxyInfo {
  id: number;
  proxy_info: string;
}

function getPasswordOnlyAccounts(): XAccount[] {
  const accounts = query<XAccount>(
    `SELECT container_id, x_password, twofa_code, email, proxy_id
     FROM x_accounts
     WHERE (auth_token IS NULL OR auth_token = '') AND (ct0 IS NULL OR ct0 = '')
     ORDER BY created_at ASC`
  );
  return accounts || [];
}

function getProxyInfo(proxyId: number | null): string | null {
  if (!proxyId) {
    return null;
  }

  const proxy = query<ProxyInfo>(
    'SELECT id, proxy_info FROM proxies WHERE id = ? LIMIT 1',
    [proxyId]
  );

  if (proxy && proxy.length > 0) {
    return proxy[0].proxy_info;
  }

  return null;
}

function findPasswordLoginPreset(presetId?: number): number | null {
  if (presetId) {
    const preset = getPreset(presetId);
    if (preset) {
      return presetId;
    }
    console.error(`❌ プリセットID ${presetId} が見つかりません`);
    return null;
  }

  // プリセット名で検索
  const presets = listPresets();
  const passwordPreset = presets.find((p: any) => 
    p.name && (p.name.includes('パスワードログイン') || p.name.includes('password login'))
  );

  if (passwordPreset) {
    return passwordPreset.id;
  }

  console.error('❌ 「X パスワードログイン」プリセットが見つかりません');
  console.error('   先に scripts/create-x-password-login-preset.ts を実行してください');
  return null;
}

async function createContainerForAccount(account: XAccount): Promise<{ ok: boolean; containerId: string; message?: string }> {
  const proxyInfo = getProxyInfo(account.proxy_id);
  
  let proxy: { server: string; username?: string; password?: string } | undefined = undefined;
  if (proxyInfo) {
    const parts = proxyInfo.split(':');
    if (parts.length >= 3) {
      proxy = {
        server: parts[0].trim() + ':' + parts[1].trim(),
        username: parts[2].trim() || undefined,
        password: parts[3]?.trim() || undefined
      };
    } else if (parts.length === 2) {
      proxy = {
        server: parts[0].trim() + ':' + parts[1].trim()
      };
    }
  }

  try {
    const result = await createContainer({
      name: account.container_id,
      proxy: proxy,
      timeoutMs: 60000
    });

    return result;
  } catch (e: any) {
    return {
      ok: false,
      containerId: account.container_id,
      message: String(e)
    };
  }
}

function createLoginTask(account: XAccount, presetId: number, proxyInfo: string | null): string | null {
  try {
    const overrides: Record<string, string> = {
      container_name: account.container_id,
      x_username: account.container_id,
      x_password: account.x_password,
    };

    if (account.twofa_code) {
      overrides.twofa_code = account.twofa_code;
    }

    const runId = enqueueTask({
      presetId: presetId,
      containerId: account.container_id,
      overrides: overrides,
      proxy: proxyInfo || undefined,
    });

    return runId;
  } catch (e: any) {
    console.error(`❌ タスク作成エラー: ${account.container_id} - ${e?.message || String(e)}`);
    return null;
  }
}

async function main() {
  // データベース初期化
  initDb({ wal: true });

  // プリセットIDを取得
  const args = process.argv.slice(2);
  const presetIdArg = args[0] ? parseInt(args[0], 10) : undefined;
  const presetId = findPasswordLoginPreset(presetIdArg);
  
  if (!presetId) {
    process.exit(1);
  }

  console.log(`✓ プリセットID ${presetId} を使用します`);
  console.log('');

  console.log('🔍 パスワードのみのXアカウントを取得中...\n');

  // パスワードのみのアカウントを取得
  const accounts = getPasswordOnlyAccounts();
  
  if (accounts.length === 0) {
    console.log('❌ パスワードのみのアカウントが見つかりませんでした');
    console.log('   （auth_tokenとct0がNULLのアカウントが必要です）');
    process.exit(1);
  }

  console.log(`✓ ${accounts.length}件のアカウントを取得しました\n`);

  // 統計情報
  let containerCreated = 0;
  let containerSkipped = 0;
  let containerErrors = 0;
  let taskCreated = 0;
  let taskErrors = 0;

  // 各アカウントを処理
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    console.log(`[${i + 1}/${accounts.length}] 処理中: ${account.container_id}`);

    // プロキシ情報を取得
    const proxyInfo = getProxyInfo(account.proxy_id);
    if (proxyInfo) {
      console.log(`  ✓ プロキシ: ${proxyInfo}`);
    }

    // コンテナを作成
    console.log(`  📦 コンテナを作成中...`);
    const containerResult = await createContainerForAccount(account);
    
    if (containerResult.ok) {
      containerCreated++;
      console.log(`  ✓ コンテナを作成しました: ${containerResult.containerId}`);
    } else {
      // 既に存在する場合はスキップ
      if (containerResult.message && containerResult.message.includes('already exists')) {
        containerSkipped++;
        console.log(`  ⊘ コンテナは既に存在します: ${account.container_id}`);
      } else {
        containerErrors++;
        console.error(`  ✗ コンテナ作成エラー: ${containerResult.message}`);
        continue; // コンテナ作成に失敗した場合はスキップ
      }
    }

    // ログインタスクを作成
    console.log(`  📝 ログインタスクを作成中...`);
    const runId = createLoginTask(account, presetId, proxyInfo);
    
    if (runId) {
      taskCreated++;
      console.log(`  ✓ ログインタスクを作成しました: ${runId}`);
    } else {
      taskErrors++;
      console.error(`  ✗ ログインタスク作成に失敗しました`);
    }

    console.log('');
  }

  // 結果サマリ
  console.log('='.repeat(50));
  console.log('📊 処理結果サマリ');
  console.log('='.repeat(50));
  console.log(`処理対象アカウント: ${accounts.length}件`);
  console.log(`コンテナ作成成功: ${containerCreated}件`);
  console.log(`コンテナ既存: ${containerSkipped}件`);
  console.log(`コンテナ作成エラー: ${containerErrors}件`);
  console.log(`ログインタスク作成成功: ${taskCreated}件`);
  console.log(`ログインタスク作成エラー: ${taskErrors}件`);
  console.log('='.repeat(50));

  if (containerErrors > 0 || taskErrors > 0) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

