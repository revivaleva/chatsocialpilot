/**
 * container_idの更新を確認するスクリプト
 */

import { initDb, query } from '../src/drivers/db';

function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function main() {
  initDb({ wal: true });

  console.log('🔍 container_idの更新を確認中...\n');

  // x_accountsテーブルを確認
  const xAccounts = query<{ container_id: string }>(
    'SELECT container_id FROM x_accounts LIMIT 10',
    []
  );

  console.log('📊 x_accountsテーブルのサンプル（最初の10件）:');
  let uuidCount = 0;
  let nameCount = 0;

  for (const account of xAccounts) {
    const isUuidFormat = isUuid(account.container_id);
    console.log(`  ${account.container_id} (UUID形式: ${isUuidFormat})`);
    if (isUuidFormat) {
      uuidCount++;
    } else {
      nameCount++;
    }
  }

  const totalXAccounts = query<{ count: number }>('SELECT COUNT(*) as count FROM x_accounts');
  const totalUuidXAccounts = query<{ count: number }>(
    "SELECT COUNT(*) as count FROM x_accounts WHERE container_id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'"
  );

  console.log(`\n📊 x_accountsテーブルの統計:`);
  console.log(`  総数: ${totalXAccounts[0]?.count || 0}件`);
  console.log(`  UUID形式: ${totalUuidXAccounts[0]?.count || 0}件`);

  // tasksテーブルを確認
  console.log('\n📊 tasksテーブルのcontainer_idを確認中...\n');
  const tasks = query<{ container_id: string; preset_id: number }>(
    'SELECT container_id, preset_id FROM tasks WHERE container_id IS NOT NULL LIMIT 10',
    []
  );

  console.log('📊 tasksテーブルのサンプル（最初の10件）:');
  let taskUuidCount = 0;
  let taskNameCount = 0;

  for (const task of tasks) {
    const isUuidFormat = isUuid(task.container_id);
    console.log(`  Preset ${task.preset_id}: ${task.container_id} (UUID形式: ${isUuidFormat})`);
    if (isUuidFormat) {
      taskUuidCount++;
    } else {
      taskNameCount++;
    }
  }

  const totalTasks = query<{ count: number }>('SELECT COUNT(*) as count FROM tasks WHERE container_id IS NOT NULL');
  const totalUuidTasks = query<{ count: number }>(
    "SELECT COUNT(*) as count FROM tasks WHERE container_id IS NOT NULL AND container_id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'"
  );

  console.log(`\n📊 tasksテーブルの統計:`);
  console.log(`  総数: ${totalTasks[0]?.count || 0}件`);
  console.log(`  UUID形式: ${totalUuidTasks[0]?.count || 0}件`);
  console.log(`  名前形式: ${(totalTasks[0]?.count || 0) - (totalUuidTasks[0]?.count || 0)}件`);
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}

