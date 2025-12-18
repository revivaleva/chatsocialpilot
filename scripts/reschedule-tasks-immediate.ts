#!/usr/bin/env tsx
/**
 * プロフィール変更タスクの実行予定日時を即時実行に戻す
 */

import { initDb, query, run } from '../src/drivers/db.js';

function main() {
  initDb();

  // プリセット18（プロフィール変更）で、状態がpendingのタスクを取得
  const pendingTasks = query<any>(
    `SELECT id, runId, container_id, scheduled_at, status 
     FROM tasks 
     WHERE preset_id = 18 
     AND status = 'pending'
     ORDER BY created_at ASC`
  );

  console.log('='.repeat(80));
  console.log('プロフィール変更タスク（pending）');
  console.log('='.repeat(80));
  console.log(`件数: ${pendingTasks.length}件\n`);

  if (pendingTasks.length === 0) {
    console.log('実行待ちのタスクはありません。');
    return;
  }

  const now = Date.now();
  console.log(`現在時刻: ${new Date(now).toLocaleString()}`);
  console.log(`実行予定日時を即時実行（NULL）に変更します\n`);

  // 各タスクの実行予定日時をNULLに更新（即時実行）
  let updatedCount = 0;
  for (const task of pendingTasks) {
    try {
      run(
        'UPDATE tasks SET scheduled_at = NULL, updated_at = ? WHERE id = ?',
        [now, task.id]
      );
      updatedCount++;
      console.log(`✓ ${task.runId} (コンテナ: ${task.container_id})`);
    } catch (e: any) {
      console.error(`✗ ${task.runId}: ${e?.message || String(e)}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('更新完了');
  console.log('='.repeat(80));
  console.log(`更新したタスク数: ${updatedCount}件`);
  console.log(`実行予定日時: 即時実行（NULL）`);
  console.log('='.repeat(80));
}

main();

