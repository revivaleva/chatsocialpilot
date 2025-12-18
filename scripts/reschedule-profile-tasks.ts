#!/usr/bin/env tsx
/**
 * 残っているプロフィール変更タスクの実行予定日時を24時間後に変更
 */

import { initDb, query, run } from '../src/drivers/db.js';

function main() {
  initDb();

  // プリセット18（プロフィール変更）で、状態がpendingのタスクを取得
  const pendingTasks = query<any>(
    `SELECT id, runId, container_id, scheduled_at, created_at, status 
     FROM tasks 
     WHERE preset_id = 18 
     AND status = 'pending'
     ORDER BY created_at ASC`
  );

  console.log('='.repeat(80));
  console.log('残っているプロフィール変更タスク');
  console.log('='.repeat(80));
  console.log(`件数: ${pendingTasks.length}件\n`);

  if (pendingTasks.length === 0) {
    console.log('実行待ちのタスクはありません。');
    return;
  }

  // 24時間後のタイムスタンプを計算
  const now = Date.now();
  const scheduledAt = now + (24 * 60 * 60 * 1000); // 24時間 = 86400000ミリ秒

  console.log(`現在時刻: ${new Date(now).toLocaleString()}`);
  console.log(`新しい実行予定日時: ${new Date(scheduledAt).toLocaleString()}\n`);

  // 各タスクの実行予定日時を更新
  let updatedCount = 0;
  for (const task of pendingTasks) {
    try {
      run(
        'UPDATE tasks SET scheduled_at = ?, updated_at = ? WHERE id = ?',
        [scheduledAt, now, task.id]
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
  console.log(`新しい実行予定日時: ${new Date(scheduledAt).toLocaleString()}`);
  console.log('='.repeat(80));
}

main();

