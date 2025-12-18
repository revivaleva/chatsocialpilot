#!/usr/bin/env tsx
/**
 * 指定範囲のプロフィール変更タスクを復元（pendingに戻す）
 */

import { initDb, query, run } from '../src/drivers/db.js';

function main() {
  const startRunId = process.argv[2] || 'run-18-2025-12-08T13-57-56-805Z-986700';
  const endRunId = process.argv[3] || 'run-18-2025-12-08T13-57-56-741Z-336765';

  initDb();

  // 指定範囲のタスクを取得（Run IDの文字列比較で範囲を指定）
  // Run IDは時系列順なので、startRunIdとendRunIdの間のタスクを取得
  const rangeTasks = query<any>(
    `SELECT id, runId, container_id, status, created_at, updated_at 
     FROM tasks 
     WHERE preset_id = 18 
     AND runId >= ? 
     AND runId <= ?
     ORDER BY runId DESC`
  , [endRunId, startRunId]);

  console.log('='.repeat(80));
  console.log('指定範囲のプロフィール変更タスク');
  console.log('='.repeat(80));
  console.log(`開始Run ID: ${endRunId}`);
  console.log(`終了Run ID: ${startRunId}`);
  console.log(`件数: ${rangeTasks.length}件\n`);

  if (rangeTasks.length === 0) {
    console.log('該当するタスクはありません。');
    return;
  }

  const now = Date.now();
  console.log(`現在時刻: ${new Date(now).toLocaleString()}`);
  console.log(`タスクを復元（pendingに戻す）します\n`);

  // 各タスクをpendingに戻す
  let restoredCount = 0;
  for (const task of rangeTasks) {
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

