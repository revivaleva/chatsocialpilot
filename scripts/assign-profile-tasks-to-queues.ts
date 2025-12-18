#!/usr/bin/env tsx
/**
 * グループのプロフィール変更タスクをqueue8、queue9、queue10に等分して割り振る
 * 
 * 使用方法:
 *   tsx scripts/assign-profile-tasks-to-queues.ts <グループ名>
 * 
 * 例:
 *   tsx scripts/assign-profile-tasks-to-queues.ts "X兵隊12/17作成、プロフィール未変更"
 */

import { initDb, query, run } from '../src/drivers/db.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

function defaultCbDir(): string {
  const appData = os.platform() === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : path.join(os.homedir(), '.config');
  return path.join(appData, 'container-browser');
}

function defaultContainerDb(): string {
  return process.env.DEFAULT_CB_DB || path.join(defaultCbDir(), 'data.db');
}

function getContainersFromDb(): Array<{ id: string; name: string }> {
  const dbPath = defaultContainerDb();
  
  if (!fs.existsSync(dbPath)) {
    return [];
  }
  
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT id, name
    FROM containers ORDER BY updatedAt DESC
  `).all();
  
  return rows.map((r: any) => ({ id: r.id, name: r.name || r.id }));
}

/**
 * グループ名からグループIDを取得
 */
function getGroupIdByName(groupName: string): string | null {
  const groups = query<{ id: string; name: string }>(
    'SELECT id, name FROM container_groups WHERE name = ?',
    [groupName]
  );

  if (groups.length === 0) {
    return null;
  }

  if (groups.length === 1) {
    return groups[0].id;
  }

  // 同名グループが複数ある場合はコンテナ数が多い方を優先
  let bestGroup = groups[0];
  let maxContainerCount = 0;

  for (const group of groups) {
    const containerCount = query<{ count: number }>(
      'SELECT COUNT(*) as count FROM container_group_members WHERE group_id = ?',
      [group.id]
    )[0]?.count || 0;

    if (containerCount > maxContainerCount) {
      maxContainerCount = containerCount;
      bestGroup = group;
    }
  }

  return bestGroup.id;
}

function main() {
  const groupName = process.argv[2];

  if (!groupName) {
    console.error('使い方: tsx scripts/assign-profile-tasks-to-queues.ts <グループ名>');
    console.error('');
    console.error('例:');
    console.error('  tsx scripts/assign-profile-tasks-to-queues.ts "X兵隊12/17作成、プロフィール未変更"');
    process.exit(1);
  }

  // DB初期化
  initDb();

  // グループIDを取得
  const groupId = getGroupIdByName(groupName);
  if (!groupId) {
    console.error(`エラー: グループ "${groupName}" が見つかりませんでした`);
    process.exit(1);
  }

  console.log(`グループ: ${groupName} (ID: ${groupId})\n`);

  // グループメンバーを取得
  const members = query<{ container_id: string }>(
    'SELECT container_id FROM container_group_members WHERE group_id = ? ORDER BY id ASC',
    [groupId]
  );

  console.log(`グループメンバー数: ${members.length}件\n`);

  // コンテナDBからコンテナ情報を取得
  const containers = getContainersFromDb();
  const containerMap = new Map<string, string>(); // UUID -> コンテナ名
  const nameToUuidMap = new Map<string, string>(); // コンテナ名 -> UUID
  for (const c of containers) {
    containerMap.set(c.id, c.name);
    nameToUuidMap.set(c.name, c.id);
  }

  // グループメンバーのUUIDセットを作成
  const groupUuids = new Set<string>();
  for (const m of members) {
    groupUuids.add(m.container_id);
  }

  // プリセット18（プロフィール変更）のタスクを取得
  const tasks = query<{ id: number; runId: string; container_id: string | null; queue_name: string | null }>(
    `SELECT id, runId, container_id, queue_name 
     FROM tasks 
     WHERE preset_id = 18 AND container_id IS NOT NULL
     ORDER BY created_at ASC`
  );

  console.log(`プリセット18のタスク総数: ${tasks.length}件\n`);

  // グループに属するコンテナのタスクを抽出
  const groupTasks: Array<{ id: number; runId: string; container_id: string; queue_name: string | null }> = [];
  
  for (const task of tasks) {
    if (!task.container_id) continue;
    
    // container_idがUUIDの場合はそのまま、コンテナ名の場合はUUIDに変換
    let uuid = task.container_id;
    if (!groupUuids.has(task.container_id)) {
      const uuidFromName = nameToUuidMap.get(task.container_id);
      if (uuidFromName && groupUuids.has(uuidFromName)) {
        uuid = uuidFromName;
      } else {
        continue; // グループに属さない
      }
    }
    
    if (groupUuids.has(uuid)) {
      groupTasks.push({
        id: task.id,
        runId: task.runId,
        container_id: task.container_id,
        queue_name: task.queue_name || null
      });
    }
  }

  console.log(`グループに属するプロフィール変更タスク: ${groupTasks.length}件\n`);

  if (groupTasks.length === 0) {
    console.error('エラー: グループに属するプロフィール変更タスクが見つかりませんでした');
    process.exit(1);
  }

  // 33件ずつに等分
  const tasksPerQueue = Math.ceil(groupTasks.length / 3);
  console.log(`1キューあたりのタスク数: ${tasksPerQueue}件（合計${groupTasks.length}件を3つのキューに分割）\n`);

  // タスクを3つのグループに分割
  const queue8Tasks = groupTasks.slice(0, tasksPerQueue);
  const queue9Tasks = groupTasks.slice(tasksPerQueue, tasksPerQueue * 2);
  const queue10Tasks = groupTasks.slice(tasksPerQueue * 2);

  console.log('='.repeat(80));
  console.log('割り振り計画');
  console.log('='.repeat(80));
  console.log(`queue8: ${queue8Tasks.length}件（タスクID: ${queue8Tasks[0]?.id} 〜 ${queue8Tasks[queue8Tasks.length - 1]?.id}）`);
  console.log(`queue9: ${queue9Tasks.length}件（タスクID: ${queue9Tasks[0]?.id} 〜 ${queue9Tasks[queue9Tasks.length - 1]?.id}）`);
  console.log(`queue10: ${queue10Tasks.length}件（タスクID: ${queue10Tasks[0]?.id} 〜 ${queue10Tasks[queue10Tasks.length - 1]?.id}）`);
  console.log('');

  // キューを割り振る
  let updateCount = 0;

  // queue8
  if (queue8Tasks.length > 0) {
    const ids = queue8Tasks.map(t => t.id);
    const placeholders = ids.map(() => '?').join(',');
    const updated = run(
      `UPDATE tasks SET queue_name = 'queue8', updated_at = ? WHERE id IN (${placeholders})`,
      [Date.now(), ...ids]
    );
    updateCount += queue8Tasks.length;
    console.log(`✓ queue8に${queue8Tasks.length}件のタスクを割り振りました`);
  }

  // queue9
  if (queue9Tasks.length > 0) {
    const ids = queue9Tasks.map(t => t.id);
    const placeholders = ids.map(() => '?').join(',');
    run(
      `UPDATE tasks SET queue_name = 'queue9', updated_at = ? WHERE id IN (${placeholders})`,
      [Date.now(), ...ids]
    );
    updateCount += queue9Tasks.length;
    console.log(`✓ queue9に${queue9Tasks.length}件のタスクを割り振りました`);
  }

  // queue10
  if (queue10Tasks.length > 0) {
    const ids = queue10Tasks.map(t => t.id);
    const placeholders = ids.map(() => '?').join(',');
    run(
      `UPDATE tasks SET queue_name = 'queue10', updated_at = ? WHERE id IN (${placeholders})`,
      [Date.now(), ...ids]
    );
    updateCount += queue10Tasks.length;
    console.log(`✓ queue10に${queue10Tasks.length}件のタスクを割り振りました`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('完了');
  console.log('='.repeat(80));
  console.log(`合計${updateCount}件のタスクのキューを更新しました`);
  console.log('');
}

main();



