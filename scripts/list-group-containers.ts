#!/usr/bin/env tsx
/**
 * グループのコンテナ情報を一覧表示
 */

import { initDb, query } from '../src/drivers/db.js';
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

function probeContainersFromDb(dbPath: string) {
  if (!fs.existsSync(dbPath)) throw new Error(`db not found: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT id,name,userDataDir,partition,updatedAt
    FROM containers ORDER BY updatedAt DESC
  `).all();
  return rows.map((r: any) => ({ id: r.id, name: r.name || r.id, dir: r.userDataDir, partition: r.partition, updatedAt: r.updatedAt }));
}

function main() {
  initDb();
  
  const groupId = 'g-1765172239362-8954';
  
  // グループメンバーを取得
  const members = query<any>(
    'SELECT container_id FROM container_group_members WHERE group_id = ? ORDER BY id ASC',
    [groupId]
  );
  
  console.log(`グループメンバー数: ${members.length}件\n`);
  
  // コンテナDBからコンテナ情報を取得
  const dbPath = defaultContainerDb();
  console.log(`コンテナDB: ${dbPath}\n`);
  
  if (!fs.existsSync(dbPath)) {
    console.error(`コンテナDBが見つかりません: ${dbPath}`);
    process.exit(1);
  }
  
  try {
    const containers = probeContainersFromDb(dbPath);
    console.log(`コンテナDB内のコンテナ数: ${containers.length}件\n`);
    
    // UUIDからコンテナ名へのマッピングを作成
    const uuidToName = new Map<string, string>();
    for (const c of containers) {
      uuidToName.set(c.id, c.name);
    }
    
    console.log('グループメンバーとコンテナDBの対応:');
    console.log('='.repeat(80));
    let foundCount = 0;
    let notFoundCount = 0;
    
    for (let i = 0; i < Math.min(members.length, 10); i++) {
      const member = members[i];
      const uuid = member.container_id;
      const containerName = uuidToName.get(uuid);
      
      if (containerName) {
        console.log(`${i + 1}. UUID: ${uuid}`);
        console.log(`   コンテナ名: ${containerName} ✓`);
        foundCount++;
      } else {
        console.log(`${i + 1}. UUID: ${uuid}`);
        console.log(`   コンテナ名: (見つかりません) ✗`);
        notFoundCount++;
      }
      console.log('');
    }
    
    console.log('='.repeat(80));
    console.log(`一致: ${foundCount}件、不一致: ${notFoundCount}件`);
    
    if (foundCount > 0) {
      const firstFound = members.find((m: any) => uuidToName.has(m.container_id));
      if (firstFound) {
        const containerName = uuidToName.get(firstFound.container_id);
        console.log(`\n最初に見つかったコンテナ名: ${containerName}`);
        console.log(`このコンテナ名を使用してタスクを修正できます。`);
      }
    }
  } catch (e: any) {
    console.error(`エラー: ${e?.message || String(e)}`);
    process.exit(1);
  }
}

main();

