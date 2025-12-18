#!/usr/bin/env tsx
/**
 * コンテナDBに存在しないUUIDをグループメンバーから削除
 */

import { initDb, query, run } from '../src/drivers/db.js';

initDb();

console.log('='.repeat(80));
console.log('コンテナDBに存在しないUUIDをグループから削除');
console.log('='.repeat(80));
console.log('');

// グループ「X兵隊12/18作成、プロフィール未変更」
const groupInfo = query<{ id: string }>(
  `SELECT id FROM container_groups WHERE name = 'X兵隊12/18作成、プロフィール未変更'`
);

if (groupInfo.length === 0) {
  console.error('エラー: グループが見つかりません');
  process.exit(1);
}

const groupId = groupInfo[0].id;

// 削除対象のUUID
const missingUUIDs = [
  '97347191-927d-4d9a-949d-d589cb157769',
  'ba220039-6240-424f-bd02-dca9aee852b2',
  '0794d855-963d-421d-a1e7-1e4c18138d35'
];

// 削除前の状況確認
const beforeMembers = query<{ count: number }>(
  'SELECT COUNT(*) as count FROM container_group_members WHERE group_id = ?',
  [groupId]
);

console.log('削除前の状況:');
console.log(`  グループメンバー数: ${beforeMembers[0].count}件\n`);

// 削除対象の確認
console.log('削除対象のUUID:');
for (let i = 0; i < missingUUIDs.length; i++) {
  const uuid = missingUUIDs[i];
  
  const exists = query<{ count: number }>(
    'SELECT COUNT(*) as count FROM container_group_members WHERE group_id = ? AND container_id = ?',
    [groupId, uuid]
  );
  
  const status = (exists[0].count as any) > 0 ? '✓ グループに存在' : '✗ グループに存在しない';
  console.log(`  ${i + 1}. ${uuid}`);
  console.log(`     ${status}`);
}

console.log('');

// 削除実行
console.log('='.repeat(80));
console.log('削除実行中...');
console.log('='.repeat(80));
console.log('');

let deletedCount = 0;

for (const uuid of missingUUIDs) {
  try {
    run(
      'DELETE FROM container_group_members WHERE group_id = ? AND container_id = ?',
      [groupId, uuid]
    );
    console.log(`✓ 削除完了: ${uuid}`);
    deletedCount++;
  } catch (e: any) {
    console.error(`✗ エラー: ${uuid} - ${e?.message}`);
  }
}

console.log('');

// 削除後の状況確認
const afterMembers = query<{ count: number }>(
  'SELECT COUNT(*) as count FROM container_group_members WHERE group_id = ?',
  [groupId]
);

console.log('='.repeat(80));
console.log('削除後の状況');
console.log('='.repeat(80));
console.log('');
console.log(`  削除件数: ${deletedCount}件`);
console.log(`  グループメンバー数: ${beforeMembers[0].count}件 → ${afterMembers[0].count}件`);
console.log('');

if (afterMembers[0].count === beforeMembers[0].count - deletedCount) {
  console.log('✓ 正常に削除されました');
}

console.log('');
console.log('='.repeat(80));
console.log('処理完了');
console.log('='.repeat(80));
