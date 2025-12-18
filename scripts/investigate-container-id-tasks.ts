#!/usr/bin/env tsx
/**
 * コンテナID（UUID）が設定されているタスクを調査
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

function isUuid(str: string): boolean {
  // UUID形式のパターン: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function main() {
  initDb();

  // プリセット18（プロフィール変更）のタスクを取得
  const tasks = query<any>(
    `SELECT id, runId, container_id, status, created_at, updated_at 
     FROM tasks 
     WHERE preset_id = 18 
     ORDER BY created_at DESC`
  );

  console.log(`プロフィール変更タスク（プリセット18）: ${tasks.length}件\n`);

  // コンテナDBからコンテナ情報を取得
  const dbPath = defaultContainerDb();
  if (!fs.existsSync(dbPath)) {
    console.error(`コンテナDBが見つかりません: ${dbPath}`);
    process.exit(1);
  }

  const containers = probeContainersFromDb(dbPath);
  const uuidToName = new Map<string, string>();
  for (const c of containers) {
    uuidToName.set(c.id, c.name);
  }

  // コンテナIDがUUID形式のタスクを抽出
  const uuidTasks = tasks.filter(t => t.container_id && isUuid(t.container_id));
  const nameTasks = tasks.filter(t => t.container_id && !isUuid(t.container_id));

  console.log('='.repeat(80));
  console.log('コンテナIDがUUID形式のタスク');
  console.log('='.repeat(80));
  console.log(`件数: ${uuidTasks.length}件\n`);

  if (uuidTasks.length > 0) {
    console.log('詳細:');
    for (const task of uuidTasks) {
      const containerName = uuidToName.get(task.container_id) || '(コンテナDBに存在しない)';
      console.log(`\nRun ID: ${task.runId}`);
      console.log(`  タスクID: ${task.id}`);
      console.log(`  コンテナID（UUID）: ${task.container_id}`);
      console.log(`  コンテナ名: ${containerName}`);
      console.log(`  状態: ${task.status}`);
      console.log(`  作成日時: ${new Date(task.created_at).toLocaleString()}`);
      console.log(`  更新日時: ${new Date(task.updated_at).toLocaleString()}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('コンテナ名が設定されているタスク');
  console.log('='.repeat(80));
  console.log(`件数: ${nameTasks.length}件\n`);

  // 時系列で分析
  console.log('='.repeat(80));
  console.log('時系列分析');
  console.log('='.repeat(80));

  const tasksByDate = new Map<string, { uuid: number; name: number }>();
  for (const task of tasks) {
    const date = new Date(task.created_at).toISOString().split('T')[0];
    if (!tasksByDate.has(date)) {
      tasksByDate.set(date, { uuid: 0, name: 0 });
    }
    const stats = tasksByDate.get(date)!;
    if (task.container_id && isUuid(task.container_id)) {
      stats.uuid++;
    } else {
      stats.name++;
    }
  }

  const sortedDates = Array.from(tasksByDate.keys()).sort();
  console.log('日付ごとの登録状況:');
  for (const date of sortedDates) {
    const stats = tasksByDate.get(date)!;
    console.log(`  ${date}: UUID形式 ${stats.uuid}件、コンテナ名 ${stats.name}件`);
  }

  // 最初のUUID形式タスクと最初のコンテナ名タスクを比較
  if (uuidTasks.length > 0 && nameTasks.length > 0) {
    const firstUuidTask = uuidTasks[uuidTasks.length - 1]; // 最も古い
    const firstNameTask = nameTasks[nameTasks.length - 1]; // 最も古い

    console.log('\n' + '='.repeat(80));
    console.log('最初のタスク比較');
    console.log('='.repeat(80));
    console.log(`最初のUUID形式タスク:`);
    console.log(`  Run ID: ${firstUuidTask.runId}`);
    console.log(`  作成日時: ${new Date(firstUuidTask.created_at).toLocaleString()}`);
    console.log(`  コンテナID: ${firstUuidTask.container_id}`);
    console.log(`\n最初のコンテナ名タスク:`);
    console.log(`  Run ID: ${firstNameTask.runId}`);
    console.log(`  作成日時: ${new Date(firstNameTask.created_at).toLocaleString()}`);
    console.log(`  コンテナID: ${firstNameTask.container_id}`);
  }

  console.log('\n' + '='.repeat(80));
}

main();

