#!/usr/bin/env tsx
/**
 * タスク2のすべてのタスクの予定時刻を2025/12/11 10:00:00に変更する
 */

import { initDb, run, query } from '../src/drivers/db.js';
import { updateAllTasksScheduledAt } from '../src/services/taskQueue.js';

const QUEUE_2_NAME = 'queue2';

function main() {
  initDb();

  // 2025年12月11日 10:00:00 JST をミリ秒のタイムスタンプに変換
  // JST = UTC+9 なので、明示的にJSTで指定
  const scheduledAt = new Date('2025-12-11T10:00:00+09:00').getTime();

  console.log('='.repeat(80));
  console.log('タスク2の予定時刻一括更新');
  console.log('='.repeat(80));
  console.log(`対象キュー: ${QUEUE_2_NAME}`);
  console.log(`新しい予定時刻: 2025年12月11日 10:00:00 JST`);
  console.log(`タイムスタンプ: ${scheduledAt}`);
  console.log(`日時（確認用）: ${new Date(scheduledAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  console.log('');

  // 更新前のタスク数を確認
  const beforeTasks = query<any>(
    'SELECT COUNT(*) as count FROM tasks WHERE queue_name = ?',
    [QUEUE_2_NAME]
  );
  const taskCount = beforeTasks[0]?.count || 0;

  if (taskCount === 0) {
    console.log('タスク2に該当するタスクがありません。');
    return;
  }

  console.log(`対象タスク数: ${taskCount}件`);
  console.log('');

  // 更新前の予定時刻を表示（サンプル）
  const sampleTasks = query<any>(
    'SELECT runId, scheduled_at FROM tasks WHERE queue_name = ? LIMIT 5',
    [QUEUE_2_NAME]
  );
  if (sampleTasks.length > 0) {
    console.log('更新前の予定時刻（サンプル）:');
    for (const task of sampleTasks) {
      const oldTime = task.scheduled_at 
        ? new Date(task.scheduled_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
        : 'NULL（即時実行）';
      console.log(`  - ${task.runId}: ${oldTime}`);
    }
    console.log('');
  }

  // 更新実行
  try {
    const updatedCount = updateAllTasksScheduledAt(scheduledAt, QUEUE_2_NAME);
    
    console.log('='.repeat(80));
    console.log('更新完了');
    console.log('='.repeat(80));
    console.log(`更新したタスク数: ${updatedCount}件`);
    console.log(`新しい予定時刻: 2025年12月11日 10:00:00 JST`);
    console.log(`タイムスタンプ: ${scheduledAt}`);
    console.log('='.repeat(80));
  } catch (e: any) {
    console.error('更新中にエラーが発生しました:');
    console.error(e?.message || String(e));
    process.exit(1);
  }
}

main();

