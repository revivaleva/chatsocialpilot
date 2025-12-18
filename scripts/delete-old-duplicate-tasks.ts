#!/usr/bin/env tsx
/**
 * グループ内のコンテナで同じコンテナに2回登録されたタスクうち、古い方（前に登録した101件）を削除
 */

import { initDb, query, run } from '../src/drivers/db.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

initDb();

console.log('='.repeat(80));
console.log('グループ内で重複登録されたタスクの削除');
console.log('古い方のタスク（前に登録した101件）を削除します');
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

// グループ内のコンテナで複数登録されているタスクを確認
const duplicateTasks = query<{
  container_id: string;
  task_ids: string;
  created_at_values: string;
}>(
  `
  SELECT 
    t.container_id,
    GROUP_CONCAT(t.id, ',') as task_ids,
    GROUP_CONCAT(t.created_at, ',') as created_at_values
  FROM tasks t
  WHERE t.queue_name = 'queue2' 
    AND t.preset_id = 18 
    AND t.container_id IS NOT NULL
    AND t.container_id IN (
      SELECT DISTINCT container_id FROM container_group_members WHERE group_id = ?
    )
  GROUP BY t.container_id
  HAVING COUNT(*) > 1
  `,
  [groupId]
);

console.log(`重複登録されているコンテナ: ${duplicateTasks.length}件`);
console.log('');

if (duplicateTasks.length === 0) {
  console.log('✓ 重複登録されているタスクはありません');
  process.exit(0);
}

// 削除対象のタスクID（古い方）
let tasksToDelete: number[] = [];

for (const item of duplicateTasks) {
  const taskIds = (item.task_ids as string).split(',').map(id => parseInt(id));
  const createdAtValues = (item.created_at_values as string).split(',').map(t => parseInt(t));
  
  // created_at が小さい方（古い方）を特定
  let oldestIdx = 0;
  let oldestTime = createdAtValues[0];
  
  for (let i = 1; i < createdAtValues.length; i++) {
    if (createdAtValues[i] < oldestTime) {
      oldestTime = createdAtValues[i];
      oldestIdx = i;
    }
  }
  
  // 古い方を削除対象に追加
  tasksToDelete.push(taskIds[oldestIdx]);
}

console.log(`削除対象のタスク: ${tasksToDelete.length}件`);
console.log('');

if (tasksToDelete.length === 0) {
  console.log('削除対象がありません');
  process.exit(0);
}

console.log('削除対象のタスクID（先頭20件）:');
tasksToDelete.slice(0, 20).forEach((id, i) => {
  console.log(`  ${i + 1}. ${id}`);
});

if (tasksToDelete.length > 20) {
  console.log(`  ... 他 ${tasksToDelete.length - 20}件`);
}

console.log('');
console.log('='.repeat(80));
console.log('削除実行中...');
console.log('='.repeat(80));
console.log('');

// タスクを削除
let deletedCount = 0;

for (const taskId of tasksToDelete) {
  try {
    run('DELETE FROM tasks WHERE id = ?', [taskId]);
    deletedCount++;
  } catch (e: any) {
    console.error(`エラー: タスクID ${taskId} の削除に失敗しました - ${e?.message}`);
  }
}

console.log(`✓ ${deletedCount}件のタスクを削除しました`);
console.log('');

// 削除後の確認
console.log('='.repeat(80));
console.log('削除後の登録状況');
console.log('='.repeat(80));
console.log('');

const afterDelete = query<{ container_id: string; count: number }>(
  `
  SELECT 
    container_id,
    COUNT(*) as count
  FROM tasks 
  WHERE queue_name = 'queue2' 
    AND preset_id = 18 
    AND container_id IN (
      SELECT DISTINCT container_id FROM container_group_members WHERE group_id = ?
    )
  GROUP BY container_id
  ORDER BY container_id
  `,
  [groupId]
);

// すべてが1件になっているか確認
const allSingle = afterDelete.every(item => (item.count as any) === 1);

if (allSingle) {
  console.log('✓ すべてのコンテナが1件ずつ登録されています');
  console.log(`✓ グループ内の登録済みコンテナ: ${afterDelete.length}件`);
  console.log(`✓ グループ内の登録済みタスク: ${afterDelete.reduce((sum, item) => sum + (item.count as any), 0)}件`);
} else {
  console.log('⚠️ 複数登録されているコンテナが残っています:');
  for (const item of afterDelete) {
    if ((item.count as any) > 1) {
      console.log(`  ${item.container_id}: ${item.count}件`);
    }
  }
}

console.log('');
console.log('='.repeat(80));
console.log('処理完了');
console.log('='.repeat(80));
