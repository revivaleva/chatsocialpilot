#!/usr/bin/env tsx
/**
 * タスクのcontainerIdが正しく保存されているか確認
 */

import { initDb, query } from '../src/drivers/db.js';

function main() {
  initDb();

  // 時間をずらしたタスク（pending）を取得
  const pendingTasks = query<any>(
    `SELECT id, runId, container_id, overrides_json, status 
     FROM tasks 
     WHERE preset_id = 18 
     AND status = 'pending'
     AND runId LIKE 'run-18-2025-12-08T13-57-56-%'
     ORDER BY created_at ASC
     LIMIT 10`
  );

  console.log('='.repeat(80));
  console.log('時間をずらしたタスクのcontainerId確認');
  console.log('='.repeat(80));
  console.log(`件数: ${pendingTasks.length}件\n`);

  let hasNullContainerId = 0;
  let hasEmptyContainerId = 0;
  let hasValidContainerId = 0;

  for (const task of pendingTasks) {
    console.log(`Run ID: ${task.runId}`);
    console.log(`  container_id: ${task.container_id || '(NULL)'}`);
    console.log(`  container_idの型: ${typeof task.container_id}`);
    console.log(`  container_idの長さ: ${task.container_id ? task.container_id.length : 0}`);
    
    if (!task.container_id) {
      hasNullContainerId++;
      console.log(`  ✗ container_idがNULLまたは空です`);
    } else if (task.container_id.trim() === '') {
      hasEmptyContainerId++;
      console.log(`  ✗ container_idが空文字列です`);
    } else {
      hasValidContainerId++;
      console.log(`  ✓ container_idが設定されています`);
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('集計');
  console.log('='.repeat(80));
  console.log(`有効なcontainer_id: ${hasValidContainerId}件`);
  console.log(`NULLまたは空のcontainer_id: ${hasNullContainerId + hasEmptyContainerId}件`);
  console.log('='.repeat(80));
}

main();

