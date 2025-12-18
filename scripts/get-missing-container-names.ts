#!/usr/bin/env tsx
/**
 * コンテナDBに存在しないUUIDのコンテナ情報を詳しく確認
 */

import { initDb, query } from '../src/drivers/db.js';

initDb();

console.log('='.repeat(80));
console.log('コンテナDBに存在しないUUIDの詳細情報');
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

// 存在しないUUIDを特定
const missingUUIDs = [
  '97347191-927d-4d9a-949d-d589cb157769',
  'ba220039-6240-424f-bd02-dca9aee852b2',
  '0794d855-963d-421d-a1e7-1e4c18138d35'
];

console.log('以下の3つのUUIDはコンテナDBに存在しません:\n');

for (let i = 0; i < missingUUIDs.length; i++) {
  const uuid = missingUUIDs[i];
  console.log(`${i + 1}. UUID: ${uuid}`);
  console.log(`   (コンテナ名: 不明 - DBに存在しないため確認不可)\n`);
}

// x_accountsテーブルから確認
console.log('='.repeat(80));
console.log('x_accountsテーブル内の情報');
console.log('='.repeat(80));
console.log('');

for (const uuid of missingUUIDs) {
  const xAccounts = query<any>(
    `SELECT * FROM x_accounts WHERE container_id = ?`,
    [uuid]
  );
  
  if (xAccounts.length > 0) {
    const acc = xAccounts[0];
    console.log(`UUID: ${uuid}`);
    console.log(`  x_username: ${acc.x_username || '(未設定)'}`);
    console.log(`  x_user_id: ${acc.x_user_id || '(未設定)'}`);
    console.log(`  auth_token: ${acc.auth_token ? '(存在)' : '(未設定)'}`);
    console.log('');
  } else {
    console.log(`UUID: ${uuid}`);
    console.log(`  x_accountsテーブルにレコードなし`);
    console.log('');
  }
}

console.log('='.repeat(80));
console.log('注釈');
console.log('='.repeat(80));
console.log('');
console.log('これらのUUIDはコンテナブラウザのDBに存在しないため、');
console.log('実際のコンテナ名を特定することはできません。');
console.log('');
console.log('・グループメンバーから削除する');
console.log('・またはコンテナブラウザで該当コンテナを作成する');
console.log('');
console.log('のどちらかの対応が必要です。');
