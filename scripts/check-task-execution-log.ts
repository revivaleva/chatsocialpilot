/**
 * タスク実行時のログを確認するスクリプト
 */

import { initDb, query } from '../src/drivers/db';

interface Task {
  id: number;
  runId: string;
  container_id: string;
  status: string;
  created_at: number;
}

function main() {
  initDb({ wal: true });

  const targetRunId = 'run-18-2025-12-10T05-13-48-385Z-365251';
  const targetContainerId = 'infoborne113558';

  console.log(`🔍 タスク実行時の状況を確認: ${targetRunId}\n`);

  // タスク情報を取得
  const tasks = query<Task>(
    'SELECT id, runId, container_id, status, created_at FROM tasks WHERE runId = ?',
    [targetRunId]
  );

  if (tasks.length === 0) {
    console.log('❌ タスクが見つかりませんでした');
    return;
  }

  const task = tasks[0];
  console.log('='.repeat(80));
  console.log('📋 タスク情報');
  console.log('='.repeat(80));
  console.log(`Run ID: ${task.runId}`);
  console.log(`Container ID (tasksテーブル): ${task.container_id}`);
  console.log(`Status: ${task.status}`);
  console.log(`Created At: ${new Date(task.created_at).toISOString()}`);

  // コンテナIDがUUID形式かどうかを確認
  const isUuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.container_id);
  console.log(`\nContainer IDがUUID形式か: ${isUuidFormat}`);

  if (!isUuidFormat) {
    console.log(`\n⚠ コンテナIDがUUID形式ではないため、taskQueue.tsの解決処理が実行されるはずです`);
    console.log(`   解決処理: Container Browser DBから名前 "${task.container_id}" でUUIDを検索`);
    console.log(`   期待されるUUID: 7382f210-bda5-4fbb-9d95-783074a84f32`);
  } else {
    console.log(`\n✓ コンテナIDがUUID形式のため、そのまま使用されます`);
  }

  // 同じコンテナIDの他のタスクを確認
  console.log('\n' + '='.repeat(80));
  console.log('📊 同じコンテナIDの他のタスク');
  console.log('='.repeat(80));
  
  const otherTasks = query<Task>(
    'SELECT id, runId, container_id, status, created_at FROM tasks WHERE container_id = ? AND runId != ? ORDER BY created_at DESC LIMIT 5',
    [targetContainerId, targetRunId]
  );

  console.log(`同じコンテナIDのタスク数: ${otherTasks.length}件\n`);
  for (const otherTask of otherTasks) {
    console.log(`Run ID: ${otherTask.runId}`);
    console.log(`  Status: ${otherTask.status}`);
    console.log(`  Created At: ${new Date(otherTask.created_at).toISOString()}`);
    console.log('');
  }

  // 成功したタスクと比較
  const successTasks = query<Task>(
    "SELECT id, runId, container_id, status FROM tasks WHERE container_id != ? AND preset_id = 18 AND status = 'completed' ORDER BY created_at DESC LIMIT 3",
    [targetContainerId]
  );

  console.log('='.repeat(80));
  console.log('📊 成功した他のタスク（参考）');
  console.log('='.repeat(80));
  for (const successTask of successTasks) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(successTask.container_id);
    console.log(`Run ID: ${successTask.runId}`);
    console.log(`  Container ID: ${successTask.container_id}`);
    console.log(`  UUID形式か: ${isUuid}`);
    console.log('');
  }
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}

