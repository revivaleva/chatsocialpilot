/**
 * 各コンテナに登録されているフォロワー数確認タスクを3分割（各キューに57コンテナずつ）に整理するスクリプト
 * 各コンテナから2つのタスクを削除し、1つのキューにのみ残す
 */

import { initDb, query as dbQuery, run as dbRun } from '../src/drivers/db.js';
import * as PresetService from '../src/services/presets.js';

// データベース初期化
initDb({ wal: true });

// タスク1～3のキュー名
const QUEUE_NAMES = ['default', 'queue2', 'queue3'];

async function main() {
  console.log('=== フォロワー数確認タスクの整理スクリプト開始 ===\n');

  // 1. フォロワー数確認プリセットのIDを取得
  console.log('1. フォロワー数確認プリセットを検索中...');
  let followerPresetId: number | null = null;
  
  const allPresets = PresetService.listPresets();
  for (const preset of allPresets) {
    const presetObj = preset as any;
    const name = String(presetObj.name || '').toLowerCase();
    if (name.includes('フォロワー') || name.includes('follower')) {
      followerPresetId = presetObj.id;
      console.log(`   ✓ フォロワー数確認プリセットが見つかりました: ID=${followerPresetId}, 名前="${presetObj.name}"`);
      break;
    }
  }
  
  if (!followerPresetId) {
    console.error('   ✗ フォロワー数確認プリセットが見つかりませんでした');
    process.exit(1);
  }
  console.log('');

  // 2. 各キューでフォロワー数確認タスクを取得
  console.log('2. フォロワー数確認タスクを取得中...');
  const tasksByQueue: Record<string, any[]> = {};
  
  for (const queueName of QUEUE_NAMES) {
    const tasks = dbQuery<any>(
      `SELECT id, runId, container_id, queue_name 
       FROM tasks 
       WHERE queue_name = ? AND preset_id = ? AND status != 'done'
       ORDER BY container_id, created_at ASC`,
      [queueName, followerPresetId]
    );
    tasksByQueue[queueName] = tasks;
    console.log(`   ${queueName}: ${tasks.length}件のタスク`);
  }
  console.log('');

  // 3. コンテナごとにタスクをグループ化
  console.log('3. コンテナごとにタスクをグループ化中...');
  const tasksByContainer: Record<string, any[]> = {};
  
  for (const queueName of QUEUE_NAMES) {
    for (const task of tasksByQueue[queueName]) {
      const containerId = task.container_id;
      if (!containerId) continue;
      
      if (!tasksByContainer[containerId]) {
        tasksByContainer[containerId] = [];
      }
      tasksByContainer[containerId].push(task);
    }
  }
  
  const containerCount = Object.keys(tasksByContainer).length;
  console.log(`   ✓ ${containerCount}個のコンテナにタスクが登録されています\n`);

  // 4. 各コンテナを3分割（各キューに57コンテナずつ）
  console.log('4. コンテナを3分割して整理中...');
  const containerIds = Object.keys(tasksByContainer).sort();
  const containersPerQueue = Math.ceil(containerIds.length / 3);
  
  console.log(`   総コンテナ数: ${containerIds.length}`);
  console.log(`   各キューあたり: 約${containersPerQueue}コンテナ`);
  console.log('');

  // 各キューに割り当てるコンテナを決定
  const queueAssignments: Record<string, string[]> = {
    'default': [],
    'queue2': [],
    'queue3': [],
  };
  
  for (let i = 0; i < containerIds.length; i++) {
    const containerId = containerIds[i];
    const queueIndex = i % 3;
    const queueName = QUEUE_NAMES[queueIndex];
    queueAssignments[queueName].push(containerId);
  }
  
  console.log('   割り当て:');
  for (const queueName of QUEUE_NAMES) {
    console.log(`     ${queueName}: ${queueAssignments[queueName].length}コンテナ`);
  }
  console.log('');

  // 5. 各コンテナから不要なタスクを削除
  console.log('5. 不要なタスクを削除中...');
  let deletedCount = 0;
  
  for (const containerId of containerIds) {
    const tasks = tasksByContainer[containerId];
    if (tasks.length === 0) continue;
    
    // このコンテナが割り当てられているキューを決定
    let assignedQueue: string | null = null;
    for (const queueName of QUEUE_NAMES) {
      if (queueAssignments[queueName].includes(containerId)) {
        assignedQueue = queueName;
        break;
      }
    }
    
    if (!assignedQueue) {
      console.error(`   ✗ エラー: コンテナ ${containerId} の割り当てが見つかりません`);
      continue;
    }
    
    // 割り当てられたキュー以外のタスクを削除
    for (const task of tasks) {
      if (task.queue_name !== assignedQueue) {
        try {
          dbRun('DELETE FROM tasks WHERE id = ?', [task.id]);
          deletedCount++;
        } catch (e: any) {
          console.error(`   ✗ エラー: タスク ${task.id} の削除に失敗: ${e?.message || String(e)}`);
        }
      }
    }
    
    if (deletedCount % 50 === 0 && deletedCount > 0) {
      console.log(`   ${deletedCount}件削除済み...`);
    }
  }
  
  console.log(`   ✓ 合計 ${deletedCount}件のタスクを削除しました\n`);

  // 6. 最終確認
  console.log('6. 最終確認中...');
  const finalTasksByQueue: Record<string, number> = {};
  
  for (const queueName of QUEUE_NAMES) {
    const count = dbQuery<any>(
      'SELECT COUNT(*) as count FROM tasks WHERE queue_name = ? AND preset_id = ? AND status != ?',
      [queueName, followerPresetId, 'done']
    )[0]?.count || 0;
    finalTasksByQueue[queueName] = count;
  }
  
  console.log('   最終的なタスク数:');
  for (const queueName of QUEUE_NAMES) {
    console.log(`     ${queueName}: ${finalTasksByQueue[queueName]}件`);
  }
  console.log('');

  // 7. 結果サマリー
  console.log('=== 処理完了 ===');
  console.log(`削除したタスク: ${deletedCount}件`);
  console.log(`残ったタスク: ${Object.values(finalTasksByQueue).reduce((a, b) => a + b, 0)}件`);
  console.log(`対象コンテナ数: ${containerIds.length}個`);
  console.log(`使用したプリセットID: ${followerPresetId}`);
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});





