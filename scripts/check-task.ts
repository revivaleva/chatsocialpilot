#!/usr/bin/env tsx
/**
 * タスクの詳細情報を確認
 */

import { initDb, query } from '../src/drivers/db.js';

const runId = process.argv[2];

if (!runId) {
  console.error('使い方: tsx scripts/check-task.ts <runId>');
  process.exit(1);
}

initDb();

const tasks = query<{
  runId: string;
  preset_id: number;
  container_id: string;
  overrides_json: string;
  status: string;
  created_at: number;
}>(
  'SELECT runId, preset_id, container_id, overrides_json, status, created_at FROM tasks WHERE runId = ?',
  [runId]
);

if (tasks.length === 0) {
  console.error(`タスク ${runId} が見つかりませんでした`);
  process.exit(1);
}

const task = tasks[0];

console.log('='.repeat(80));
console.log('タスク詳細');
console.log('='.repeat(80));
console.log(`Run ID: ${task.runId}`);
console.log(`プリセットID: ${task.preset_id}`);
console.log(`コンテナID: ${task.container_id}`);
console.log(`ステータス: ${task.status}`);
console.log(`作成日時: ${new Date(task.created_at).toISOString()}`);
console.log('');
console.log('Overrides JSON (raw):');
console.log(task.overrides_json);
console.log('');

try {
  const overrides = JSON.parse(task.overrides_json);
  console.log('Overrides (parsed):');
  console.log(JSON.stringify(overrides, null, 2));
  console.log('');
  
  if (overrides.avatar_image_path) {
    console.log(`✓ avatar_image_path: ${overrides.avatar_image_path}`);
  } else {
    console.log('✗ avatar_image_path: 未設定');
  }
  
  if (overrides.banner_image_path) {
    console.log(`✓ banner_image_path: ${overrides.banner_image_path}`);
  } else {
    console.log('✗ banner_image_path: 未設定');
  }
} catch (e: any) {
  console.error('Overrides JSONのパースに失敗:', e.message);
}

console.log('='.repeat(80));
