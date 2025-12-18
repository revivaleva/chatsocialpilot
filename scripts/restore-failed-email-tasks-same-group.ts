#!/usr/bin/env tsx
/**
 * タスク2のメールアドレス変更タスク（preset_id = 22）で、
 * 同じグループの実行済みタスクのうち、失敗してまだ成功していないものを復元する
 * - statusを'pending'に戻す
 * - scheduled_atを3日後に設定
 */

import { initDb, run, query } from '../src/drivers/db.js';

const QUEUE_2_NAME = 'queue2';
const EMAIL_CHANGE_PRESET_ID = 22;

interface TaskInfo {
  id: number;
  runId: string;
  container_id: string | null;
  status: string;
  scheduled_at: number | null;
  group_id: string | null;
}

function main() {
  initDb();

  // 現在時刻から3日後を計算
  const now = Date.now();
  const threeDaysLater = now + (3 * 24 * 60 * 60 * 1000); // 3日 = 3 * 24時間 * 60分 * 60秒 * 1000ミリ秒

  console.log('='.repeat(80));
  console.log('タスク2のメールアドレス変更タスク：同じグループの失敗タスクを復元');
  console.log('='.repeat(80));
  console.log(`対象キュー: ${QUEUE_2_NAME}`);
  console.log(`対象プリセットID: ${EMAIL_CHANGE_PRESET_ID}`);
  console.log(`現在時刻: ${new Date(now).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  console.log(`新しい予定時刻: ${new Date(threeDaysLater).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
  console.log('');

  // 1. タスク2のメールアドレス変更タスクで、実行済み（failed/stopped/done）のものを取得
  // ただし、成功していないもの（failed/stopped）のみを対象
  const executedTasks = query<TaskInfo>(
    `SELECT t.id, t.runId, t.container_id, t.status, t.scheduled_at, cgm.group_id
     FROM tasks t
     LEFT JOIN container_group_members cgm ON t.container_id = cgm.container_id
     WHERE t.queue_name = ? 
       AND t.preset_id = ?
       AND t.status IN ('failed', 'stopped', 'done')
     ORDER BY t.id`,
    [QUEUE_2_NAME, EMAIL_CHANGE_PRESET_ID]
  );

  if (executedTasks.length === 0) {
    console.log('実行済みのタスクが見つかりませんでした。');
    return;
  }

  console.log(`実行済みタスク総数: ${executedTasks.length}件`);
  console.log('');

  // 2. グループごとに分類し、失敗しているタスクを特定
  const groupMap = new Map<string, TaskInfo[]>();
  const noGroupTasks: TaskInfo[] = [];

  for (const task of executedTasks) {
    if (task.group_id) {
      if (!groupMap.has(task.group_id)) {
        groupMap.set(task.group_id, []);
      }
      groupMap.get(task.group_id)!.push(task);
    } else {
      noGroupTasks.push(task);
    }
  }

  // 3. 各グループで、失敗しているタスクを特定
  // 同じグループ内で、成功（done）していないタスク（failed/stopped）を復元対象とする
  const tasksToRestore: TaskInfo[] = [];

  // グループごとに処理
  for (const [groupId, groupTasks] of groupMap.entries()) {
    // グループ内で成功しているタスク（status = 'done'）を確認
    const successTasks = groupTasks.filter(t => t.status === 'done');
    const failedTasks = groupTasks.filter(t => t.status === 'failed' || t.status === 'stopped');

    if (failedTasks.length > 0) {
      // グループ内に失敗タスクがある場合、それらを復元対象に追加
      // ただし、同じグループ内で成功しているタスクがある場合でも、失敗タスクは復元する
      console.log(`グループ ${groupId}:`);
      console.log(`  - 成功タスク: ${successTasks.length}件`);
      console.log(`  - 失敗タスク: ${failedTasks.length}件（復元対象）`);
      
      for (const task of failedTasks) {
        tasksToRestore.push(task);
      }
    }
  }

  // グループに属していない失敗タスクも復元対象に追加
  const noGroupFailedTasks = noGroupTasks.filter(t => t.status === 'failed' || t.status === 'stopped');
  if (noGroupFailedTasks.length > 0) {
    console.log(`グループ未所属の失敗タスク: ${noGroupFailedTasks.length}件（復元対象）`);
    tasksToRestore.push(...noGroupFailedTasks);
  }

  if (tasksToRestore.length === 0) {
    console.log('');
    console.log('復元対象のタスクが見つかりませんでした。');
    console.log('（すべて成功しているか、実行済みの失敗タスクがありません）');
    return;
  }

  console.log('');
  console.log(`復元対象タスク数: ${tasksToRestore.length}件`);
  console.log('');

  // 復元対象タスクの詳細を表示（サンプル）
  console.log('復元対象タスク（サンプル）:');
  for (const task of tasksToRestore.slice(0, 10)) {
    const oldTime = task.scheduled_at 
      ? new Date(task.scheduled_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
      : 'NULL（即時実行）';
    const groupInfo = task.group_id ? `グループ: ${task.group_id}` : 'グループ未所属';
    console.log(`  - ${task.runId}: ${task.status} (${oldTime}) [${groupInfo}]`);
  }
  if (tasksToRestore.length > 10) {
    console.log(`  ... 他 ${tasksToRestore.length - 10}件`);
  }
  console.log('');

  // 4. 復元実行
  try {
    let restoredCount = 0;
    for (const task of tasksToRestore) {
      const result = run(
        'UPDATE tasks SET status = ?, scheduled_at = ?, updated_at = ? WHERE id = ?',
        ['pending', threeDaysLater, Date.now(), task.id]
      );
      if ((result as any).changes > 0) {
        restoredCount++;
      }
    }
    
    console.log('='.repeat(80));
    console.log('復元完了');
    console.log('='.repeat(80));
    console.log(`復元したタスク数: ${restoredCount}件`);
    console.log(`新しい予定時刻: ${new Date(threeDaysLater).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);
    console.log(`タイムスタンプ: ${threeDaysLater}`);
    console.log('='.repeat(80));
  } catch (e: any) {
    console.error('復元中にエラーが発生しました:');
    console.error(e?.message || String(e));
    process.exit(1);
  }
}

main();











