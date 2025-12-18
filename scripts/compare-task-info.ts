#!/usr/bin/env tsx
/**
 * 復元で動いたタスクと新しく登録したタスクの情報を比較
 */

import { initDb, query } from '../src/drivers/db.js';

function main() {
  initDb();

  // 復元で動いたタスク（成功したタスク）を取得
  const successTasks = query<any>(
    `SELECT id, runId, container_id, overrides_json, scheduled_at, status, created_at, updated_at 
     FROM tasks 
     WHERE preset_id = 18 
     AND status = 'done'
     ORDER BY updated_at DESC
     LIMIT 5`
  );

  // さっき時間をずらしたタスク（pending）を取得
  const rescheduledTasks = query<any>(
    `SELECT id, runId, container_id, overrides_json, scheduled_at, status, created_at, updated_at 
     FROM tasks 
     WHERE preset_id = 18 
     AND status = 'pending'
     AND runId LIKE 'run-18-2025-12-08T13-57-56-%'
     ORDER BY created_at ASC
     LIMIT 5`
  );

  console.log('='.repeat(80));
  console.log('成功したタスク（復元で動いたもの）');
  console.log('='.repeat(80));
  if (successTasks.length > 0) {
    const task = successTasks[0];
    console.log(`Run ID: ${task.runId}`);
    console.log(`コンテナID: ${task.container_id}`);
    console.log(`状態: ${task.status}`);
    console.log(`scheduled_at: ${task.scheduled_at ? new Date(task.scheduled_at).toLocaleString() : 'NULL'}`);
    console.log(`overrides_json: ${task.overrides_json}`);
    try {
      const overrides = JSON.parse(task.overrides_json || '{}');
      console.log(`overrides (parsed):`, JSON.stringify(overrides, null, 2));
    } catch (e) {
      console.log(`overrides (parse error): ${e}`);
    }
  } else {
    console.log('成功したタスクが見つかりませんでした。');
  }

  console.log('\n' + '='.repeat(80));
  console.log('時間をずらしたタスク（pending）');
  console.log('='.repeat(80));
  if (rescheduledTasks.length > 0) {
    const task = rescheduledTasks[0];
    console.log(`Run ID: ${task.runId}`);
    console.log(`コンテナID: ${task.container_id}`);
    console.log(`状態: ${task.status}`);
    console.log(`scheduled_at: ${task.scheduled_at ? new Date(task.scheduled_at).toLocaleString() : 'NULL'}`);
    console.log(`overrides_json: ${task.overrides_json}`);
    try {
      const overrides = JSON.parse(task.overrides_json || '{}');
      console.log(`overrides (parsed):`, JSON.stringify(overrides, null, 2));
    } catch (e) {
      console.log(`overrides (parse error): ${e}`);
    }
  } else {
    console.log('時間をずらしたタスクが見つかりませんでした。');
  }

  // 比較
  console.log('\n' + '='.repeat(80));
  console.log('比較結果');
  console.log('='.repeat(80));
  
  if (successTasks.length > 0 && rescheduledTasks.length > 0) {
    const successTask = successTasks[0];
    const rescheduledTask = rescheduledTasks[0];
    
    console.log('\nコンテナID:');
    console.log(`  成功: ${successTask.container_id || 'NULL'}`);
    console.log(`  新規: ${rescheduledTask.container_id || 'NULL'}`);
    console.log(`  一致: ${successTask.container_id === rescheduledTask.container_id ? '✓' : '✗'}`);
    
    console.log('\noverrides_json:');
    try {
      const successOverrides = JSON.parse(successTask.overrides_json || '{}');
      const rescheduledOverrides = JSON.parse(rescheduledTask.overrides_json || '{}');
      
      console.log(`  成功:`, Object.keys(successOverrides).join(', ') || '(空)');
      console.log(`  新規:`, Object.keys(rescheduledOverrides).join(', ') || '(空)');
      
      // 各キーを比較
      const allKeys = new Set([...Object.keys(successOverrides), ...Object.keys(rescheduledOverrides)]);
      for (const key of allKeys) {
        const successVal = successOverrides[key];
        const rescheduledVal = rescheduledOverrides[key];
        const match = JSON.stringify(successVal) === JSON.stringify(rescheduledVal);
        console.log(`    ${key}: ${match ? '✓' : '✗'} (成功: ${successVal !== undefined ? 'あり' : 'なし'}, 新規: ${rescheduledVal !== undefined ? 'あり' : 'なし'})`);
      }
    } catch (e) {
      console.log(`  パースエラー: ${e}`);
    }
    
    console.log('\nscheduled_at:');
    console.log(`  成功: ${successTask.scheduled_at ? new Date(successTask.scheduled_at).toLocaleString() : 'NULL'}`);
    console.log(`  新規: ${rescheduledTask.scheduled_at ? new Date(rescheduledTask.scheduled_at).toLocaleString() : 'NULL'}`);
  }

  console.log('\n' + '='.repeat(80));
}

main();

