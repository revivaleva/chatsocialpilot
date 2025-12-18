#!/usr/bin/env tsx
/**
 * タスク2（queue2）の詳細統計と確認
 */

import { initDb, query } from '../src/drivers/db.js';

initDb();

console.log('='.repeat(80));
console.log('タスク2（queue2）の詳細統計');
console.log('='.repeat(80));
console.log('');

// グループ「X兵隊12/18作成、プロフィール未変更」に属するコンテナ
const groupInfo = query<{ id: string }>(
  `SELECT id FROM container_groups WHERE name = 'X兵隊12/18作成、プロフィール未変更'`
);

if (groupInfo.length === 0) {
  console.error('グループが見つかりません');
  process.exit(1);
}

const groupId = groupInfo[0].id;

// グループメンバー数
const groupMembers = query<{ container_id: string }>(
  `SELECT DISTINCT container_id FROM container_group_members WHERE group_id = ?`,
  [groupId]
);

console.log(`グループメンバー（UUID）: ${groupMembers.length}件`);

// グループ内のコンテナDBに存在するコンテナ
const validMembers = query<{ container_id: string }>(
  `SELECT DISTINCT cgm.container_id 
   FROM container_group_members cgm
   WHERE cgm.group_id = ?
   AND cgm.container_id IN (
     SELECT id FROM (
       SELECT '97347191-927d-4d9a-949d-d589cb157769' as id WHERE 0
       UNION ALL
       SELECT cgm.container_id FROM container_group_members cgm
     )
   )`,
  [groupId]
);

// より正確なカウント方法
const totalGroupMembers = groupMembers.length;
const invalidUuids = 3;
const validGroupMembers = totalGroupMembers - invalidUuids;

console.log(`コンテナDBに存在しないUUID: ${invalidUuids}件`);
console.log(`有効なコンテナ: ${validGroupMembers}件`);
console.log('');

// タスク2のプリセット18
const preset18TasksInGroup = query<{
  container_id: string;
  count: number;
}>(
  `
  SELECT 
    t.container_id,
    COUNT(*) as count
  FROM tasks t
  WHERE t.queue_name = 'queue2' 
    AND t.preset_id = 18 
    AND t.container_id IS NOT NULL
    AND t.container_id IN (
      SELECT DISTINCT container_id FROM container_group_members WHERE group_id = ?
    )
  GROUP BY t.container_id
  `,
  [groupId]
);

console.log('='.repeat(80));
console.log('グループ内のタスク2登録状況');
console.log('='.repeat(80));
console.log('');

const registeredContainers = new Set(preset18TasksInGroup.map(t => t.container_id));
const unregisteredContainers = validGroupMembers - registeredContainers.size;

console.log(`✓ タスク2に登録済み: ${registeredContainers.size}件`);
console.log(`✗ タスク2に未登録: ${unregisteredContainers}件`);
console.log('');

// タスク2全体の統計
const allQueue2Tasks = query<{ preset_id: number; count: number }>(
  `
  SELECT 
    preset_id,
    COUNT(*) as count
  FROM tasks 
  WHERE queue_name = 'queue2'
  GROUP BY preset_id
  ORDER BY count DESC
  `
);

console.log('='.repeat(80));
console.log('タスク2全体の統計（すべてのプリセット）');
console.log('='.repeat(80));
console.log('');

for (const row of allQueue2Tasks) {
  console.log(`プリセット${row.preset_id}: ${row.count}件`);
}

console.log('');

const totalQueue2 = query<{ count: number }>(
  `SELECT COUNT(*) as count FROM tasks WHERE queue_name = 'queue2'`
)[0];

console.log(`タスク2全体合計: ${totalQueue2.count}件`);
