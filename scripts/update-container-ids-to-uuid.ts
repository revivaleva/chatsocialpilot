/**
 * x_accountsテーブルのcontainer_idを名前形式からUUID形式に更新するスクリプト
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { initDb, query, run } from '../src/drivers/db';

interface XAccount {
  container_id: string;
  email: string | null;
}

function appData(): string {
  return process.env.APPDATA || path.join(process.env.HOME || '', 'AppData', 'Roaming');
}

function defaultContainerDb(): string {
  return process.env.DEFAULT_CB_DB || path.join(appData(), 'container-browser', 'data.db');
}

function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function main() {
  initDb({ wal: true });

  console.log('🔧 x_accountsテーブルのcontainer_idをUUID形式に更新中...\n');

  // Container Browser DBからコンテナ情報を取得
  const containerDbPath = defaultContainerDb();
  if (!fs.existsSync(containerDbPath)) {
    console.error(`❌ Container Browser DBが見つかりません: ${containerDbPath}`);
    return;
  }

  const containerDb = new Database(containerDbPath, { readonly: true });
  const containerRows = containerDb.prepare(`
    SELECT id, name FROM containers
  `).all() as any[];

  // 名前→UUIDのマップを作成
  const nameToUuidMap = new Map<string, string>();
  for (const row of containerRows) {
    const name = String(row.name || '');
    const uuid = String(row.id || '');
    if (name && uuid && isUuid(uuid)) {
      nameToUuidMap.set(name, uuid);
    }
  }

  console.log(`Container Browser DBのコンテナ数: ${containerRows.length}件`);
  console.log(`名前→UUIDマップ数: ${nameToUuidMap.size}件\n`);

  // x_accountsテーブルからUUID形式でないcontainer_idを取得
  const xAccounts = query<XAccount>(
    'SELECT container_id, email FROM x_accounts',
    []
  );

  console.log(`x_accountsテーブルのアカウント数: ${xAccounts.length}件\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const notFoundList: string[] = [];

  console.log('📝 container_idを更新中...\n');

  for (let i = 0; i < xAccounts.length; i++) {
    const account = xAccounts[i];
    const currentContainerId = account.container_id;

    // 既にUUID形式の場合はスキップ
    if (isUuid(currentContainerId)) {
      skippedCount++;
      continue;
    }

    // 名前からUUIDを取得
    const uuid = nameToUuidMap.get(currentContainerId);

    if (!uuid) {
      notFoundList.push(currentContainerId);
      errorCount++;
      console.warn(`  ⚠ UUIDが見つかりません: ${currentContainerId}`);
      continue;
    }

    try {
      // container_idをUUID形式に更新
      run(
        'UPDATE x_accounts SET container_id = ?, updated_at = ? WHERE container_id = ?',
        [uuid, Date.now(), currentContainerId]
      );
      updatedCount++;

      if ((i + 1) % 10 === 0 || (i + 1) === xAccounts.length) {
        console.log(`  [${i + 1}/${xAccounts.length}] 処理中...`);
      }
    } catch (e: any) {
      errorCount++;
      console.error(`  ✗ エラー: ${currentContainerId} -> ${uuid} - ${e?.message || String(e)}`);
    }
  }

  containerDb.close();

  console.log('\n' + '='.repeat(60));
  console.log('📊 処理結果サマリ');
  console.log('='.repeat(60));
  console.log(`対象アカウント数: ${xAccounts.length}件`);
  console.log(`✓ 更新成功: ${updatedCount}件`);
  console.log(`⊘ スキップ（既にUUID形式）: ${skippedCount}件`);
  console.log(`✗ エラー/見つからない: ${errorCount}件`);
  console.log('='.repeat(60));

  if (notFoundList.length > 0) {
    console.log(`\n⚠ UUIDが見つからなかったコンテナ（${notFoundList.length}件）:`);
    if (notFoundList.length <= 20) {
      notFoundList.forEach(name => console.log(`  - ${name}`));
    } else {
      notFoundList.slice(0, 20).forEach(name => console.log(`  - ${name}`));
      console.log(`  ... 他 ${notFoundList.length - 20}件`);
    }
  }

  // 更新後の確認
  const uuidCount = query<{ count: number }>(
    "SELECT COUNT(*) as count FROM x_accounts WHERE container_id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'"
  );
  console.log(`\nUUID形式のcontainer_id数: ${uuidCount[0]?.count || 0}件`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}

