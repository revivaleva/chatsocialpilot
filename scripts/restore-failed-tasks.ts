#!/usr/bin/env tsx
/**
 * 失敗したプロフィール変更タスクを復元（pendingに戻す）
 */

import { initDb, query, run } from '../src/drivers/db.js';

function main() {
  initDb();

  // プリセット18（プロフィール変更）で、失敗したタスクを取得
  const failedTasks = query<any>(
    `SELECT id, runId, container_id, status, created_at, updated_at 
     FROM tasks 
     WHERE preset_id = 18 
     AND status IN ('failed', 'waiting_failed', 'stopped')
     AND runId LIKE 'run-18-2025-12-08T13-57-56-%'
     ORDER BY created_at ASC`
  );

  console.log('='.repeat(80));
  console.log('失敗したプロフィール変更タスク');
  console.log('='.repeat(80));
  console.log(`件数: ${failedTasks.length}件\n`);

  if (failedTasks.length === 0) {
    console.log('失敗したタスクはありません。');
    return;
  }

  const now = Date.now();
  console.log(`現在時刻: ${new Date(now).toLocaleString()}`);
  console.log(`タスクを復元（pendingに戻す）します\n`);

  // 各タスクをpendingに戻す
  let restoredCount = 0;
  for (const task of failedTasks) {
    try {
      // 状態をpendingに戻し、scheduled_atをNULL（即時実行）に設定
      run(
        'UPDATE tasks SET status = ?, scheduled_at = NULL, updated_at = ? WHERE id = ?',
        ['pending', now, task.id]
      );
      restoredCount++;
      console.log(`✓ ${task.runId} (コンテナ: ${task.container_id}, 元の状態: ${task.status})`);
    } catch (e: any) {
      console.error(`✗ ${task.runId}: ${e?.message || String(e)}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('復元完了');
  console.log('='.repeat(80));
  console.log(`復元したタスク数: ${restoredCount}件`);
  console.log(`新しい状態: pending（即時実行）`);
  console.log('='.repeat(80));
}

main();

