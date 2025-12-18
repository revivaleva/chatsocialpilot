#!/usr/bin/env tsx
/**
 * タスクのcontainer_idをUUIDからコンテナ名に修正
 */

import { initDb, query, run } from '../src/drivers/db.js';
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
  
  const runId = 'run-18-2025-12-08T12-51-11-351Z-362573';
  const groupId = 'g-1765172239362-8954';
  
  // タスク情報を取得
  const task = query<any>(
    'SELECT id, runId, container_id FROM tasks WHERE runId = ?',
    [runId]
  )[0];
  
  if (!task) {
    console.error(`タスクが見つかりません: ${runId}`);
    process.exit(1);
  }
  
  console.log(`タスクID: ${task.id}`);
  console.log(`Run ID: ${task.runId}`);
  console.log(`現在のcontainer_id: ${task.container_id}`);
  
  // コンテナDBからコンテナ情報を取得
  const dbPath = defaultContainerDb();
  console.log(`\nコンテナDB: ${dbPath}`);
  
  if (!fs.existsSync(dbPath)) {
    console.error(`コンテナDBが見つかりません: ${dbPath}`);
    process.exit(1);
  }
  
  try {
    const containers = probeContainersFromDb(dbPath);
    console.log(`コンテナ数: ${containers.length}`);
    
    // UUIDからコンテナ名へのマッピングを作成
    const uuidToName = new Map<string, string>();
    for (const c of containers) {
      uuidToName.set(c.id, c.name);
    }
    
    // 現在のcontainer_id（UUID）に一致するコンテナ名を探す
    let containerName = uuidToName.get(task.container_id);
    
    if (!containerName) {
      // UUIDが見つからない場合、グループメンバーから最初に見つかったコンテナ名を使用
      console.log(`\n現在のcontainer_id（UUID: ${task.container_id}）に一致するコンテナが見つかりませんでした`);
      console.log(`グループメンバーから最初に見つかったコンテナ名を使用します。`);
      
      const members = query<any>(
        'SELECT container_id FROM container_group_members WHERE group_id = ? ORDER BY id ASC',
        [groupId]
      );
      
      for (const m of members) {
        const name = uuidToName.get(m.container_id);
        if (name) {
          containerName = name;
          console.log(`使用するコンテナ名: ${containerName}`);
          break;
        }
      }
    }
    
    if (containerName) {
      console.log(`\nコンテナ名: ${containerName}`);
      console.log(`コンテナ名に更新します。`);
      run(
        'UPDATE tasks SET container_id = ? WHERE runId = ?',
        [containerName, runId]
      );
      console.log(`✓ タスクのcontainer_idを ${containerName} に更新しました`);
    } else {
      console.log(`\nコンテナ名が見つかりませんでした`);
      process.exit(1);
    }
  } catch (e: any) {
    console.error(`エラー: ${e?.message || String(e)}`);
    process.exit(1);
  }
}

main();

