#!/usr/bin/env tsx
/**
 * グループ内の全登録状況を詳細確認
 * UUIDとコンテナ名の両方で検索
 */

import { initDb, query } from '../src/drivers/db.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

initDb();

console.log('='.repeat(80));
console.log('グループ内のタスク2登録状況の詳細確認');
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

console.log('='.repeat(80));
console.log('グループメンバーの登録状況');
console.log('='.repeat(80));
console.log('');

// グループメンバーのうち、有効なもの（コンテナブラウザに存在）
let validCount = 0;
let registeredByUUIDCount = 0;
let registeredByNameCount = 0;
let unregisteredCount = 0;

for (const m of groupMembers) {
  const containerName = containerMap.get(m.container_id);
  
  if (!containerName) {
    // コンテナDBに存在しない
    continue;
  }
  
  validCount++;
  
  // UUIDでの登録を確認
  const byUUID = query<{ count: number }>(
    `SELECT COUNT(*) as count FROM tasks 
     WHERE queue_name = 'queue2' 
     AND preset_id = 18 
     AND container_id = ?`,
    [m.container_id]
  );
  
  // コンテナ名での登録を確認
  const byName = query<{ count: number }>(
    `SELECT COUNT(*) as count FROM tasks 
     WHERE queue_name = 'queue2' 
     AND preset_id = 18 
     AND container_id = ?`,
    [containerName]
  );
  
  const uuidCount = byUUID[0].count || 0;
  const nameCount = byName[0].count || 0;
  
  if (uuidCount > 0) registeredByUUIDCount += uuidCount;
  if (nameCount > 0) registeredByNameCount += nameCount;
  
  if (uuidCount === 0 && nameCount === 0) {
    unregisteredCount++;
  }
}

console.log(`✓ 有効なグループメンバー: ${validCount}件`);
console.log(`✓ UUIDで登録されたタスク: ${registeredByUUIDCount}件`);
console.log(`✓ コンテナ名で登録されたタスク: ${registeredByNameCount}件`);
console.log(`✗ 未登録のコンテナ: ${unregisteredCount}件`);
console.log('');

// タスク2全体の統計（プリセット18）
const allPreset18InQueue2 = query<{ count: number }>(
  `SELECT COUNT(*) as count FROM tasks 
   WHERE queue_name = 'queue2' 
   AND preset_id = 18`
);

console.log(`タスク2のプリセット18全体: ${allPreset18InQueue2[0].count}件`);
console.log('');

// グループ内のコンテナ名一覧を取得
const groupContainerNames: string[] = [];
for (const m of groupMembers) {
  const containerName = containerMap.get(m.container_id);
  if (containerName) {
    groupContainerNames.push(containerName);
  }
}

console.log('='.repeat(80));
console.log('グループ内のコンテナ名一覧（先頭20件）');
console.log('='.repeat(80));
console.log('');

groupContainerNames.slice(0, 20).forEach((name, i) => {
  console.log(`  ${i + 1}. ${name}`);
});

if (groupContainerNames.length > 20) {
  console.log(`  ... 他 ${groupContainerNames.length - 20}件`);
}

console.log('');

// タスク2のプリセット18で登録されているコンテナ名
const registeredContainerNames = query<{ container_id: string; count: number }>(
  `SELECT DISTINCT container_id, COUNT(*) as count FROM tasks 
   WHERE queue_name = 'queue2' 
   AND preset_id = 18 
   AND container_id IS NOT NULL
   GROUP BY container_id
   ORDER BY count DESC`
);

console.log('='.repeat(80));
console.log('タスク2のプリセット18で登録されているコンテナ（先頭20件）');
console.log('='.repeat(80));
console.log('');

let totalRegistered = 0;
for (const item of registeredContainerNames.slice(0, 20)) {
  const count = (item.count as any);
  totalRegistered += count;
  console.log(`  ${item.container_id} (${count}件)`);
}

console.log('');
console.log(`登録済みコンテナ数（ユニーク）: ${registeredContainerNames.length}件`);
console.log(`登録済みタスク数（先頭20件分の合計）: ${totalRegistered}件`);
