/**
 * 単一のXアカウントデータを登録するスクリプト（コンテナ存在確認付き）
 * 
 * データ形式: XID;Xパスワード;旧メールアドレス;旧メールパスワード;2FAコード;Authトークン;ct0
 *           または
 *           XID:Xパスワード:旧メールアドレス:旧メールパスワード:2FAコード:Authトークン:ct0
 * 
 * 使用方法:
 *   npx tsx scripts/register-single-x-account.ts "<データ行>"
 * 
 * 例:
 *   npx tsx scripts/register-single-x-account.ts "fusionwild2262;mBDAgH6aixCxx9;lihumeragree2453@outlook.com;KInD647c;ZNO2CWAMXO5RPXT4;5465f88fd13e2b0bff3e6c8a33b3116c32dc16f2;e4616d71d68f192ac3bad5515722fb7e52ee7074004b1b3bcfd68cb02847e353f79a9f34f763a0aeddfd8527cde77c25b2aab3605170fa0f24f59fcb5f078244df45851679f4f5f6b682f731350c88d9"
 */

import { initDb, run, query } from '../src/drivers/db';

interface XAccountData {
  xId: string;          // parts[0] - コンテナIDとして使用
  xPassword: string;   // parts[1]
  twofaCode: string;   // parts[4]
  authToken: string;   // parts[5]
  ct0: string;         // parts[6]
}

interface ContainerInfo {
  id: string;
  name: string;
}

/**
 * コンテナ一覧を取得（Container Browser API経由）
 */
async function fetchContainers(): Promise<ContainerInfo[]> {
  try {
    // ダッシュボードサーバーのポート（デフォルト5174）
    const port = process.env.DASHBOARD_PORT || '5174';
    const response = await fetch(`http://localhost:${port}/api/containers`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const json = await response.json();
    return json.items || [];
  } catch (e: any) {
    console.error(`⚠ コンテナ一覧の取得に失敗しました: ${e?.message || String(e)}`);
    console.error(`   ダッシュボードサーバーが起動していることを確認してください（http://localhost:${process.env.DASHBOARD_PORT || '5174'}）`);
    return [];
  }
}

/**
 * コンテナID（XID）でコンテナを検索
 */
async function findContainerByXId(xId: string): Promise<ContainerInfo[]> {
  const containers = await fetchContainers();
  
  // コンテナ名またはIDがXIDと一致するものを検索
  return containers.filter((c: ContainerInfo) => {
    const name = (c.name || '').trim();
    const id = (c.id || '').trim();
    return name === xId || id === xId;
  });
}

function parseAccountLine(line: string): XAccountData | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  // セミコロンまたはコロンで分割を試みる
  let parts: string[];
  if (trimmed.includes(';')) {
    parts = trimmed.split(';');
  } else if (trimmed.includes(':')) {
    parts = trimmed.split(':');
  } else {
    console.error('❌ 区切り文字（; または :）が見つかりません');
    return null;
  }

  if (parts.length < 7) {
    console.error(`❌ 行の形式が不正です（7つのフィールドが必要）: ${trimmed.substring(0, 50)}...`);
    console.error(`   実際のフィールド数: ${parts.length}`);
    return null;
  }

  return {
    xId: parts[0],
    xPassword: parts[1],
    twofaCode: parts[4],
    authToken: parts[5],
    ct0: parts[6],
  };
}

function checkExistingAccount(containerId: string): boolean {
  const existing = query<{ id: number }>(
    'SELECT id FROM x_accounts WHERE container_id = ?',
    [containerId]
  );
  return existing && existing.length > 0;
}

async function insertXAccount(data: XAccountData): Promise<{ success: boolean; message: string }> {
  const now = Date.now();

  // 既存チェック
  if (checkExistingAccount(data.xId)) {
    return {
      success: false,
      message: `既にx_accountsテーブルに存在します: ${data.xId}`,
    };
  }

  // コンテナ存在確認
  console.log(`🔍 コンテナを検索中: ${data.xId}...`);
  const matchingContainers = await findContainerByXId(data.xId);

  if (matchingContainers.length === 0) {
    return {
      success: false,
      message: `❌ コンテナが見つかりません: ${data.xId}`,
    };
  }

  if (matchingContainers.length > 1) {
    const containerList = matchingContainers.map(c => `  - ${c.name || c.id} (id: ${c.id})`).join('\n');
    return {
      success: false,
      message: `❌ 複数のコンテナが見つかりました（${matchingContainers.length}件）:\n${containerList}`,
    };
  }

  const container = matchingContainers[0];
  console.log(`✓ コンテナを確認: ${container.name || container.id} (id: ${container.id})`);

  try {
    run(
      `INSERT INTO x_accounts (
        container_id, x_password, twofa_code, auth_token, ct0,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.xId,
        data.xPassword,
        data.twofaCode,
        data.authToken,
        data.ct0,
        now,
        now,
      ]
    );

    return {
      success: true,
      message: `✓ 追加成功: ${data.xId} (コンテナ: ${container.name || container.id})`,
    };
  } catch (e: any) {
    return {
      success: false,
      message: `❌ エラー: ${data.xId} - ${e?.message || String(e)}`,
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('❌ データ行を指定してください');
    console.error('');
    console.error('使用方法:');
    console.error('  npx tsx scripts/register-single-x-account.ts "<データ行>"');
    console.error('');
    console.error('データ形式（セミコロンまたはコロン区切り）:');
    console.error('  XID;Xパスワード;旧メールアドレス;旧メールパスワード;2FAコード;Authトークン;ct0');
    console.error('  または');
    console.error('  XID:Xパスワード:旧メールアドレス:旧メールパスワード:2FAコード:Authトークン:ct0');
    process.exit(1);
  }

  const dataLine = args.join(' '); // 複数の引数がある場合は結合

  // データベース初期化
  initDb({ wal: true });

  // データパース
  const data = parseAccountLine(dataLine);
  if (!data) {
    console.error('❌ データのパースに失敗しました');
    process.exit(1);
  }

  console.log('📋 登録情報:');
  console.log(`  XID: ${data.xId}`);
  console.log(`  Xパスワード: ${data.xPassword.substring(0, 10)}...`);
  console.log(`  2FAコード: ${data.twofaCode}`);
  console.log(`  Authトークン: ${data.authToken.substring(0, 20)}...`);
  console.log(`  ct0: ${data.ct0.substring(0, 20)}...`);
  console.log('');

  // 登録実行
  const result = await insertXAccount(data);

  console.log('');
  if (result.success) {
    console.log('✅ ' + result.message);
    process.exit(0);
  } else {
    console.error('❌ ' + result.message);
    process.exit(1);
  }
}

main();

