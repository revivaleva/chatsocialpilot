#!/usr/bin/env tsx
/**
 * done状態のプロフィール変更タスクを復元（pendingに戻す）
 */

import { initDb, query, run } from '../src/drivers/db.js';

function main() {
  initDb();

  // プリセット18（プロフィール変更）で、done状態のタスクを取得
  // ただし、実行時間が短すぎる（1秒未満）ものは失敗した可能性が高い
  const doneTasks = query<any>(
    `SELECT t.id, t.runId, t.container_id, t.status, t.created_at, t.updated_at,
            tr.started_at, tr.ended_at, tr.status as run_status
     FROM tasks t
     LEFT JOIN task_runs tr ON t.runId = tr.runId
     WHERE t.preset_id = 18 
     AND t.status = 'done'
     AND t.runId LIKE 'run-18-2025-12-08T13-57-56-%'
     ORDER BY t.created_at ASC`
  );

  console.log('='.repeat(80));
  console.log('done状態のプロフィール変更タスク');
  console.log('='.repeat(80));
  console.log(`件数: ${doneTasks.length}件\n`);

  if (doneTasks.length === 0) {
    console.log('done状態のタスクはありません。');
    return;
  }

  // 実行時間が短い（失敗した可能性が高い）タスクを特定
  const suspiciousTasks = doneTasks.filter((task: any) => {
    if (task.started_at && task.ended_at) {
      const elapsed = task.ended_at - task.started_at;
      return elapsed < 5000; // 5秒未満は失敗の可能性が高い
    }
    return true; // 実行ログがない場合も復元対象
  });

  console.log(`実行時間が短いタスク（復元候補）: ${suspiciousTasks.length}件\n`);

  const now = Date.now();
  console.log(`現在時刻: ${new Date(now).toLocaleString()}`);
  console.log(`タスクを復元（pendingに戻す）します\n`);

  // 各タスクをpendingに戻す
  let restoredCount = 0;
  for (const task of suspiciousTasks) {
    try {
      // 状態をpendingに戻し、scheduled_atをNULL（即時実行）に設定
      run(
        'UPDATE tasks SET status = ?, scheduled_at = NULL, updated_at = ? WHERE id = ?',
        ['pending', now, task.id]
      );
      restoredCount++;
      const elapsed = task.started_at && task.ended_at ? `${(task.ended_at - task.started_at) / 1000}秒` : '実行ログなし';
      console.log(`✓ ${task.runId} (コンテナ: ${task.container_id}, 実行時間: ${elapsed})`);
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

