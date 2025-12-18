#!/usr/bin/env tsx
/**
 * タスク2の登録状態を詳細確認
 */

import { initDb, query } from '../src/drivers/db.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

initDb();

console.log('='.repeat(80));
console.log('タスク2（queue2）の登録状態詳細');
console.log('='.repeat(80));
console.log('');

// グループ「X兵隊12/18作成、プロフィール未変更」のメンバー数
const groupInfo = query<{ id: string; name: string }>(
  `SELECT id, name FROM container_groups WHERE name = 'X兵隊12/18作成、プロフィール未変更'`
);

if (groupInfo.length === 0) {
  console.error('グループが見つかりません');
  process.exit(1);
}

const groupId = groupInfo[0].id;

const groupMembers = query<{ container_id: string }>(
  `SELECT container_id FROM container_group_members WHERE group_id = ?`,
  [groupId]
);

console.log(`グループメンバー数（UUID）: ${groupMembers.length}件`);

// コンテナDBパスの構築
const containerDbPath = path.join(
  os.platform() === 'win32' 
    ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : path.join(os.homedir(), '.config'),
  'container-browser',
  'data.db'
);

let validContainers = 0;
const containerMap = new Map<string, string>();

if (fs.existsSync(containerDbPath)) {
  const db = new Database(containerDbPath, { readonly: true });
  const rows = db.prepare(`SELECT id, name FROM containers`).all();
  
  for (const r of rows) {
    containerMap.set((r as any).id, (r as any).name);
  }
  
  validContainers = groupMembers.filter(m => containerMap.has(m.container_id)).length;
  console.log(`グループメンバーのうちコンテナDBに存在: ${validContainers}件`);
  console.log(`グループメンバーのうちコンテナDBに未存在: ${groupMembers.length - validContainers}件`);
}

console.log('');

// タスク2のプリセット18のみ
const preset18Tasks = query<{ container_id: string; id: number }>(
  `SELECT container_id, id FROM tasks WHERE queue_name = 'queue2' AND preset_id = 18 AND container_id IS NOT NULL`
);

console.log(`全体のプリセット18・タスク2登録数: ${preset18Tasks.length}件`);

console.log('');
console.log('='.repeat(80));
console.log('登録状態の詳細:');
console.log('='.repeat(80));

// グループメンバーとタスク登録の比較
const registeredSet = new Set(preset18Tasks.map(t => t.container_id));

let registeredInGroup = 0;
let unregisteredInGroup = 0;

for (const member of groupMembers) {
  if (containerMap.has(member.container_id)) {
    if (registeredSet.has(member.container_id)) {
      registeredInGroup++;
    } else {
      unregisteredInGroup++;
    }
  }
}

console.log(`✓ グループメンバー かつ コンテナDBに存在 かつ タスク2登録済み: ${registeredInGroup}件`);
console.log(`✗ グループメンバー かつ コンテナDBに存在 かつ タスク2未登録: ${unregisteredInGroup}件`);
console.log(`ℹ グループメンバー かつ コンテナDBに未存在（無視対象）: ${groupMembers.length - validContainers}件`);

console.log('');
console.log('全体統計:');
console.log(`  グループメンバー数: ${groupMembers.length}件`);
console.log(`  有効コンテナ: ${validContainers}件`);
console.log(`  タスク2登録済み: ${registeredInGroup}件`);
console.log(`  登録対象残: ${unregisteredInGroup}件`);
