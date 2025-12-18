#!/usr/bin/env tsx
/**
 * グループ内で同じコンテナに複数登録されたタスクを直接確認して削除
 * SQLで直接GROUP BYとHAVING句で複数登録を検出
 */

import { initDb, query, run } from '../src/drivers/db.js';

initDb();

console.log('='.repeat(80));
console.log('タスク2のプリセット18で複数登録されているタスクの直接削除');
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

// 削除前の状態確認
const beforeStats = query<{ count: number }>(
  `SELECT COUNT(*) as count FROM tasks 
   WHERE queue_name = 'queue2' AND preset_id = 18`
);

console.log(`削除前：タスク2のプリセット18: ${beforeStats[0].count}件\n`);

// グループ内の全コンテナ（コンテナDBに存在するもの）
const groupMembersUUID = query<{ container_id: string }>(
  `SELECT DISTINCT container_id FROM container_group_members WHERE group_id = ?`,
  [groupId]
);

console.log(`グループメンバー（UUID）: ${groupMembersUUID.length}件`);

// グループ内で複数登録されているコンテナ（コンテナ名ベース）
const multiRegisteredContainers = query<{
  container_id: string;
  count: number;
  ids: string;
}>(
  `
  SELECT 
    t.container_id,
    COUNT(*) as count,
    GROUP_CONCAT(t.id, ',') as ids
  FROM tasks t
  WHERE t.queue_name = 'queue2' 
    AND t.preset_id = 18 
    AND t.container_id IS NOT NULL
  GROUP BY t.container_id
  HAVING COUNT(*) > 1
  ORDER BY count DESC
  `
);

console.log(`複数登録されているコンテナ数: ${multiRegisteredContainers.length}件\n`);

if (multiRegisteredContainers.length === 0) {
  console.log('✓ 重複登録されているタスクはありません');
  console.log('');
  
  // グループ内の登録状況を確認
  const groupStats = query<{ count: number }>(
    `SELECT COUNT(*) as count FROM tasks t
     WHERE t.queue_name = 'queue2' 
       AND t.preset_id = 18 
       AND t.container_id IN (
         SELECT DISTINCT container_id FROM container_group_members WHERE group_id = ?
       )`,
    [groupId]
  );
  
  console.log(`グループ内の登録済みタスク: ${groupStats[0].count}件`);
  process.exit(0);
}

// 複数登録されているコンテナごとに古い方を削除
let tasksToDelete: number[] = [];

console.log('複数登録されているコンテナ一覧:');
console.log('');

for (const container of multiRegisteredContainers) {
  console.log(`コンテナ: ${container.container_id} (${container.count}件)`);
  
  const ids = (container.ids as string).split(',').map(id => parseInt(id));
  
  // 各タスクの作成日時を確認
  const taskDetails = query<{
    id: number;
    created_at: number;
  }>(
    `SELECT id, created_at FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})
     ORDER BY created_at ASC`,
    ids
  );
  
  for (let i = 0; i < taskDetails.length; i++) {
    const createdDate = new Date(taskDetails[i].created_at).toLocaleString('ja-JP');
    const marker = i === 0 ? '✓ 保持' : '✗ 削除';
    console.log(`  [${i + 1}] ${marker} - ID: ${taskDetails[i].id} (${createdDate})`);
    
    if (i > 0) {
      tasksToDelete.push(taskDetails[i].id);
    }
  }
  console.log('');
}

console.log('='.repeat(80));
console.log(`削除対象のタスク: ${tasksToDelete.length}件`);
console.log('='.repeat(80));
console.log('');

if (tasksToDelete.length > 0) {
  console.log('削除実行中...\n');
  
  let deletedCount = 0;
  for (const taskId of tasksToDelete) {
    run('DELETE FROM tasks WHERE id = ?', [taskId]);
    deletedCount++;
    
    if (deletedCount % 20 === 0) {
      console.log(`  ${deletedCount}件削除完了...`);
    }
  }
  
  console.log(`✓ 合計${deletedCount}件を削除しました\n`);
}

// 削除後の確認
const afterStats = query<{ count: number }>(
  `SELECT COUNT(*) as count FROM tasks 
   WHERE queue_name = 'queue2' AND preset_id = 18`
);

const afterGroupStats = query<{ count: number }>(
  `SELECT COUNT(*) as count FROM tasks t
   WHERE t.queue_name = 'queue2' 
     AND t.preset_id = 18 
     AND t.container_id IN (
       SELECT DISTINCT container_id FROM container_group_members WHERE group_id = ?
     )`,
  [groupId]
);

console.log('='.repeat(80));
console.log('削除後の状況');
console.log('='.repeat(80));
console.log('');
console.log(`タスク2のプリセット18全体: ${afterStats[0].count}件（削除前: ${beforeStats[0].count}件）`);
console.log(`グループ内の登録済みタスク: ${afterGroupStats[0].count}件`);
