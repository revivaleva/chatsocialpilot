/**
 * tasksテーブルのcontainer_idを名前形式からUUID形式に更新するスクリプト
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { initDb, query, run } from '../src/drivers/db';

interface Task {
  id: number;
  runId: string;
  container_id: string;
  preset_id: number;
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

  console.log('🔧 tasksテーブルのcontainer_idをUUID形式に更新中...\n');

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

  // tasksテーブルからUUID形式でないcontainer_idを取得
  const tasks = query<Task>(
    'SELECT id, runId, container_id, preset_id FROM tasks WHERE container_id IS NOT NULL',
    []
  );

  console.log(`tasksテーブルのタスク数: ${tasks.length}件\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const notFoundList: string[] = [];

  console.log('📝 container_idを更新中...\n');

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const currentContainerId = task.container_id;

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
      console.warn(`  ⚠ UUIDが見つかりません: ${currentContainerId} (Run ID: ${task.runId})`);
      continue;
    }

    try {
      // container_idをUUID形式に更新
      run(
        'UPDATE tasks SET container_id = ?, updated_at = ? WHERE id = ?',
        [uuid, Date.now(), task.id]
      );
      updatedCount++;

      if ((i + 1) % 50 === 0 || (i + 1) === tasks.length) {
        console.log(`  [${i + 1}/${tasks.length}] 処理中...`);
      }
    } catch (e: any) {
      errorCount++;
      console.error(`  ✗ エラー: ${task.runId} - ${currentContainerId} -> ${uuid} - ${e?.message || String(e)}`);
    }
  }

  containerDb.close();

  console.log('\n' + '='.repeat(60));
  console.log('📊 処理結果サマリ');
  console.log('='.repeat(60));
  console.log(`対象タスク数: ${tasks.length}件`);
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
  const totalTasks = query<{ count: number }>('SELECT COUNT(*) as count FROM tasks WHERE container_id IS NOT NULL');
  const totalUuidTasks = query<{ count: number }>(
    "SELECT COUNT(*) as count FROM tasks WHERE container_id IS NOT NULL AND container_id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'"
  );
  console.log(`\nUUID形式のcontainer_id数: ${totalUuidTasks[0]?.count || 0}件 / ${totalTasks[0]?.count || 0}件`);

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

