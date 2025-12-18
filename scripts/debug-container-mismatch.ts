#!/usr/bin/env tsx
/**
 * コンテナ名不一致のデバッグ
 */

import { initDb, query } from '../src/drivers/db.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

initDb();

console.log('='.repeat(80));
console.log('コンテナ名不一致のデバッグ');
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
  
  console.log(`コンテナブラウザDB: ${containerMap.size}件のコンテナ`);
  console.log('');
}

// グループメンバーのうち、有効なもの（コンテナブラウザに存在）
const validGroupMembers: Array<{ uuid: string; name: string }> = [];
const invalidGroupMembers: string[] = [];

for (const m of groupMembers) {
  const name = containerMap.get(m.container_id);
  if (name) {
    validGroupMembers.push({ uuid: m.container_id, name });
  } else {
    invalidGroupMembers.push(m.container_id);
  }
}

console.log(`有効なグループメンバー: ${validGroupMembers.length}件`);
console.log(`無効なグループメンバー: ${invalidGroupMembers.length}件\n`);

// タスク2のプリセット18で登録されているコンテナ（container_idでの登録）
const registeredByName = query<{ container_id: string; count: number }>(
  `
  SELECT 
    t.container_id,
    COUNT(*) as count
  FROM tasks t
  WHERE t.queue_name = 'queue2' 
    AND t.preset_id = 18 
    AND t.container_id IS NOT NULL
  GROUP BY t.container_id
  `
);

console.log('='.repeat(80));
console.log('タスク2のプリセット18の登録状況');
console.log('='.repeat(80));
console.log('');

const registeredNameSet = new Set(registeredByName.map(t => t.container_id));

console.log(`タスク2のプリセット18: ${registeredByName.length}件のユニークコンテナ`);
console.log('');

// グループメンバー（名前）とタスク登録の比較
const registeredInGroup = validGroupMembers.filter(m => registeredNameSet.has(m.name)).length;
const unregisteredInGroup = validGroupMembers.length - registeredInGroup;

console.log(`✓ グループメンバーかつタスク2登録済み: ${registeredInGroup}件`);
console.log(`✗ グループメンバーかつタスク2未登録: ${unregisteredInGroup}件`);
console.log('');

// 登録されているコンテナ名の先頭10件を確認
console.log('登録されているコンテナ名（先頭10件）:');
registeredByName.slice(0, 10).forEach((item, i) => {
  console.log(`  ${i + 1}. ${item.container_id} (${item.count}件)`);
});

console.log('');
console.log('グループメンバーのコンテナ名（先頭10件）:');
validGroupMembers.slice(0, 10).forEach((item, i) => {
  console.log(`  ${i + 1}. ${item.name} (UUID: ${item.uuid.substring(0, 8)}...)`);
});
