#!/usr/bin/env tsx
/**
 * タスク2のメールアドレス変更タスク（preset_id = 22）の予定時刻をすべて3日後に変更する
 */

import { initDb, run, query } from '../src/drivers/db.js';

const QUEUE_2_NAME = 'queue2';
const EMAIL_CHANGE_PRESET_ID = 22;

function main() {
  initDb();

  // 現在時刻から3日後を計算
  const now = Date.now();
  const threeDaysLater = now + (3 * 24 * 60 * 60 * 1000); // 3日 = 3 * 24時間 * 60分 * 60秒 * 1000ミリ秒

  console.log('='.repeat(80));
  console.log('タスク2のメールアドレス変更タスクの予定時刻を3日後に変更');
  console.log('='.repeat(80));
  console.log(`対象キュー: ${QUEUE_2_NAME}`);
  console.log(`対象プリセットID: ${EMAIL_CHANGE_PRESET_ID}`);
  console.log(`現在時刻: ${new Date(now).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  console.log(`新しい予定時刻: ${new Date(threeDaysLater).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  console.log(`タイムスタンプ: ${threeDaysLater}`);
  console.log('');

  // 更新前のタスク数を確認
  const beforeTasks = query<any>(
    'SELECT COUNT(*) as count FROM tasks WHERE queue_name = ? AND preset_id = ?',
    [QUEUE_2_NAME, EMAIL_CHANGE_PRESET_ID]
  );
  const taskCount = beforeTasks[0]?.count || 0;

  if (taskCount === 0) {
    console.log('タスク2のメールアドレス変更タスクが見つかりませんでした。');
    return;
  }

  console.log(`対象タスク数: ${taskCount}件`);
  console.log('');

  // 更新前の予定時刻を表示（サンプル）
  const sampleTasks = query<any>(
    'SELECT runId, scheduled_at FROM tasks WHERE queue_name = ? AND preset_id = ? LIMIT 5',
    [QUEUE_2_NAME, EMAIL_CHANGE_PRESET_ID]
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
    const result = run(
      'UPDATE tasks SET scheduled_at = ?, updated_at = ? WHERE queue_name = ? AND preset_id = ?',
      [threeDaysLater, Date.now(), QUEUE_2_NAME, EMAIL_CHANGE_PRESET_ID]
    );
    const updatedCount = (result as any).changes || 0;
    
    console.log('='.repeat(80));
    console.log('更新完了');
    console.log('='.repeat(80));
    console.log(`更新したタスク数: ${updatedCount}件`);
    console.log(`新しい予定時刻: ${new Date(threeDaysLater).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    console.log(`タイムスタンプ: ${threeDaysLater}`);
    console.log('='.repeat(80));
  } catch (e: any) {
    console.error('更新中にエラーが発生しました:');
    console.error(e?.message || String(e));
    process.exit(1);
  }
}

main();











