#!/usr/bin/env tsx
/**
 * 1. グループ内で同じコンテナに2回ずつ登録されたタスクを確認
 * 2. コンテナDBに存在しないUUIDのコンテナ名を確認
 */

import { initDb, query } from '../src/drivers/db.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

initDb();

console.log('='.repeat(80));
console.log('タスク2のプリセット18重複登録と存在しないUUIDの確認');
console.log('='.repeat(80));
console.log('');

// グループ「X兵隊12/18作成、プロフィール未変更」
const groupInfo = query<{ id: string }>(
  `SELECT id FROM container_groups WHERE name = 'X兵隊12/18作成、プロフィール未変更'`
);

if (groupInfo.length === 0) {
  console.error('グループが見つかりません');
  process.exit(1);
}

const groupId = groupInfo[0].id;

// グループメンバーのUUID
const groupMembers = query<{ container_id: string }>(
  `SELECT DISTINCT container_id FROM container_group_members WHERE group_id = ?`,
  [groupId]
);

console.log(`グループメンバー（UUID）: ${groupMembers.length}件\n`);

// コンテナブラウザDBからUUID→名前マッピング
const containerDbPath = path.join(
  os.platform() === 'win32' 
    ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : path.join(os.homedir(), '.config'),
  'container-browser',
  'data.db'
);

const containerMap = new Map<string, string>();

if (fs.existsSync(containerDbPath)) {
  const db = new Database(containerDbPath, { readonly: true });
  const rows = db.prepare(`SELECT id, name FROM containers`).all();
  
  for (const r of rows) {
    containerMap.set((r as any).id, (r as any).name);
  }
}

// グループメンバーのうち、コンテナDBに存在しないもの
const missingContainers: Array<{ uuid: string }> = [];

for (const m of groupMembers) {
  if (!containerMap.has(m.container_id)) {
    missingContainers.push({ uuid: m.container_id });
  }
}

console.log('='.repeat(80));
console.log('コンテナDBに存在しないUUID');
console.log('='.repeat(80));
console.log('');

if (missingContainers.length === 0) {
  console.log('✓ コンテナDBに存在しないUUIDはありません');
} else {
  console.log(`⚠️ コンテナDBに存在しないUUID: ${missingContainers.length}件\n`);
  for (let i = 0; i < missingContainers.length; i++) {
    console.log(`  ${i + 1}. UUID: ${missingContainers[i].uuid}`);
  }
}

console.log('');

// グループ内でタスク2のプリセット18が複数登録されているコンテナを確認
const duplicateTasksByContainer = query<{
  container_id: string;
  task_count: number;
  task_ids: string;
  created_times: string;
}>(
  `
  SELECT 
    t.container_id,
    COUNT(*) as task_count,
    GROUP_CONCAT(t.id, ',') as task_ids,
    GROUP_CONCAT(datetime(t.created_at/1000, 'unixepoch'), ',') as created_times
  FROM tasks t
  WHERE t.queue_name = 'queue2' 
    AND t.preset_id = 18 
    AND t.container_id IS NOT NULL
    AND t.container_id IN (
      SELECT DISTINCT container_id FROM container_group_members WHERE group_id = ?
    )
  GROUP BY t.container_id
  ORDER BY t.container_id
  `,
  [groupId]
);

console.log('='.repeat(80));
console.log('グループ内でコンテナに複数登録されたタスク');
console.log('='.repeat(80));
console.log('');

if (duplicateTasksByContainer.length === 0) {
  console.log('✓ 重複登録されているタスクはありません');
} else {
  console.log(`⚠️ 重複登録されているタスク: ${duplicateTasksByContainer.length}件のコンテナ\n`);

  let oldTasksToDelete: number[] = [];

  for (const item of duplicateTasksByContainer) {
    const taskCount = (item.task_count as any);
    if (taskCount > 1) {
      console.log(`コンテナ: ${item.container_id} (${taskCount}件)`);
      
      const taskIds = (item.task_ids as string).split(',').map(id => parseInt(id));
      const createdTimes = (item.created_times as string).split(',');
      
      for (let i = 0; i < taskIds.length; i++) {
        const marker = i === 0 ? '✓ 保持' : '✗ 削除対象';
        console.log(`  [${i + 1}] ${marker} - Task ID: ${taskIds[i]} (作成: ${createdTimes[i]})`);
        
        if (i > 0) {
          oldTasksToDelete.push(taskIds[i]);
        }
      }
      console.log('');
    }
  }

  console.log('='.repeat(80));
  console.log('削除対象のタスク');
  console.log('='.repeat(80));
  console.log(`削除対象のタスク数: ${oldTasksToDelete.length}件`);
  console.log('');
  
  if (oldTasksToDelete.length > 0) {
    console.log('削除対象のタスクID（先頭20件）:');
    oldTasksToDelete.slice(0, 20).forEach((id, i) => {
      console.log(`  ${i + 1}. ${id}`);
    });
    if (oldTasksToDelete.length > 20) {
      console.log(`  ... 他 ${oldTasksToDelete.length - 20}件`);
    }
  }
}
