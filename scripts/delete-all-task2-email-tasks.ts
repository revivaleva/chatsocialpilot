#!/usr/bin/env tsx
/**
 * タスク2のメールアドレス変更タスク（preset_id = 22）をすべて削除する
 */

import { initDb, run, query } from '../src/drivers/db.js';

const QUEUE_2_NAME = 'queue2';
const EMAIL_CHANGE_PRESET_ID = 22;

function main() {
  initDb();

  console.log('='.repeat(80));
  console.log('タスク2のメールアドレス変更タスクをすべて削除');
  console.log('='.repeat(80));
  console.log(`対象キュー: ${QUEUE_2_NAME}`);
  console.log(`対象プリセットID: ${EMAIL_CHANGE_PRESET_ID}`);
  console.log('');

  // 削除前のタスク数を確認
  const beforeTasks = query<any>(
    'SELECT COUNT(*) as count FROM tasks WHERE queue_name = ? AND preset_id = ?',
    [QUEUE_2_NAME, EMAIL_CHANGE_PRESET_ID]
  );
  const taskCount = beforeTasks[0]?.count || 0;

  if (taskCount === 0) {
    console.log('削除対象のタスクが見つかりませんでした。');
    return;
  }

  // 状態別の集計を表示
  const statusTasks = query<any>(
    'SELECT status, COUNT(*) as count FROM tasks WHERE queue_name = ? AND preset_id = ? GROUP BY status',
    [QUEUE_2_NAME, EMAIL_CHANGE_PRESET_ID]
  );

  console.log(`削除対象タスク数: ${taskCount}件`);
  console.log('');
  console.log('状態別内訳:');
  for (const row of statusTasks) {
    console.log(`  - ${row.status}: ${row.count}件`);
  }
  console.log('');

  // 削除対象タスクのサンプルを表示
  const sampleTasks = query<any>(
    'SELECT runId, status, scheduled_at FROM tasks WHERE queue_name = ? AND preset_id = ? LIMIT 5',
    [QUEUE_2_NAME, EMAIL_CHANGE_PRESET_ID]
  );
  if (sampleTasks.length > 0) {
    console.log('削除対象タスク（サンプル）:');
    for (const task of sampleTasks) {
      const time = task.scheduled_at 
        ? new Date(task.scheduled_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
        : 'NULL（即時実行）';
      console.log(`  - ${task.runId}: ${task.status} (${time})`);
    }
    if (taskCount > 5) {
      console.log(`  ... 他 ${taskCount - 5}件`);
    }
    console.log('');
  }

  // 確認プロンプト（自動実行のため、コメントアウト）
  // const readline = require('readline');
  // const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // const answer = await new Promise(resolve => rl.question('本当に削除しますか？ (yes/no): ', resolve));
  // rl.close();
  // if (answer !== 'yes') {
  //   console.log('削除をキャンセルしました。');
  //   return;
  // }

  // 削除実行
  try {
    // まず、関連するtask_runsを削除
    const taskRunResult = run(
      `DELETE FROM task_runs 
       WHERE runId IN (
         SELECT runId FROM tasks 
         WHERE queue_name = ? AND preset_id = ?
       )`,
      [QUEUE_2_NAME, EMAIL_CHANGE_PRESET_ID]
    );
    const deletedRuns = (taskRunResult as any).changes || 0;

    // 次に、tasksを削除
    const taskResult = run(
      'DELETE FROM tasks WHERE queue_name = ? AND preset_id = ?',
      [QUEUE_2_NAME, EMAIL_CHANGE_PRESET_ID]
    );
    const deletedTasks = (taskResult as any).changes || 0;
    
    console.log('='.repeat(80));
    console.log('削除完了');
    console.log('='.repeat(80));
    console.log(`削除したタスク数: ${deletedTasks}件`);
    console.log(`削除したタスク実行履歴数: ${deletedRuns}件`);
    console.log('='.repeat(80));
  } catch (e: any) {
    console.error('削除中にエラーが発生しました:');
    console.error(e?.message || String(e));
    process.exit(1);
  }
}

main();











