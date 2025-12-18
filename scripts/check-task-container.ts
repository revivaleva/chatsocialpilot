#!/usr/bin/env tsx
/**
 * タスクのcontainer_idを確認し、必要に応じて修正
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
  
  // グループメンバーからコンテナIDを取得
  const groupId = 'g-1765172239362-8954';
  const members = query<any>(
    'SELECT container_id FROM container_group_members WHERE group_id = ? ORDER BY id ASC',
    [groupId]
  );
  
  console.log(`\nグループメンバーのcontainer_id（最初の5件）:`);
  members.slice(0, 5).forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.container_id}`);
  });
  
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
    
    // 現在のcontainer_id（UUID）に一致するコンテナを探す
    const currentContainer = containers.find((c: any) => 
      String(c.id) === task.container_id
    );
    
    if (currentContainer) {
      console.log(`\n現在のcontainer_id（UUID）に一致するコンテナ:`);
      console.log(`  UUID: ${currentContainer.id}`);
      console.log(`  名前: ${currentContainer.name}`);
      
      // コンテナ名に更新
      console.log(`\nコンテナ名に更新します。`);
      run(
        'UPDATE tasks SET container_id = ? WHERE runId = ?',
        [currentContainer.name, runId]
      );
      console.log(`✓ タスクのcontainer_idを ${currentContainer.name} に更新しました`);
    } else {
      console.log(`\n現在のcontainer_id（UUID）に一致するコンテナが見つかりません`);
      
      // グループメンバーの最初のcontainer_id（UUID）でコンテナを探す
      if (members.length > 0) {
        const firstMemberId = members[0].container_id;
        const memberContainer = containers.find((c: any) => 
          String(c.id) === firstMemberId
        );
        
        if (memberContainer) {
          console.log(`\nグループメンバーの最初のcontainer_id（UUID: ${firstMemberId}）に一致するコンテナ:`);
          console.log(`  UUID: ${memberContainer.id}`);
          console.log(`  名前: ${memberContainer.name}`);
          
          // タスクのcontainer_idを修正（コンテナ名を使用）
          run(
            'UPDATE tasks SET container_id = ? WHERE runId = ?',
            [memberContainer.name, runId]
          );
          console.log(`\n✓ タスクのcontainer_idを ${memberContainer.name} に更新しました`);
        } else {
          console.log(`\nグループメンバーのcontainer_id（UUID: ${firstMemberId}）に一致するコンテナも見つかりませんでした`);
          console.log(`\nコンテナDB内のコンテナ（最初の5件）:`);
          containers.slice(0, 5).forEach((c: any, i) => {
            console.log(`  ${i + 1}. UUID: ${c.id}, 名前: ${c.name}`);
          });
        }
      }
    }
  } catch (e: any) {
    console.error(`エラー: ${e?.message || String(e)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('エラーが発生しました:', err);
  process.exit(1);
});

