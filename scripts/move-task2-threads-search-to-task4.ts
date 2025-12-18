import 'dotenv/config';
import { initDb, query, run } from '../src/drivers/db';

/**
 * タスク2（queue2）にあるThreads検索・投稿取得のタスク（プリセットID 28）を
 * すべてタスク4（queue4）に移動するスクリプト
 */

const QUEUE_2_NAME = 'queue2';
const QUEUE_4_NAME = 'queue4';
const THREADS_SEARCH_PRESET_ID = 28; // Threads検索・投稿取得プリセット

async function main() {
  initDb({ wal: true });
  
  console.log('=== タスク2のThreads検索・投稿取得タスクをタスク4に移動 ===\n');
  console.log(`移動元キュー: ${QUEUE_2_NAME} (タスク2)`);
  console.log(`移動先キュー: ${QUEUE_4_NAME} (タスク4)`);
  console.log(`対象プリセットID: ${THREADS_SEARCH_PRESET_ID}`);
  console.log('');
  
  // タスク2に登録されているプリセット28のタスクをすべて検索
  const tasks = query<any>(
    `SELECT id, runId, preset_id, container_id, overrides_json, status, scheduled_at, created_at, queue_name
     FROM tasks
     WHERE queue_name = ?
       AND preset_id = ?
     ORDER BY created_at DESC`,
    [QUEUE_2_NAME, THREADS_SEARCH_PRESET_ID]
  );
  
  if (tasks.length === 0) {
    console.log('✅ タスク2でプリセット28が使用されているタスクはありません');
    return;
  }
  
  console.log(`対象タスク数: ${tasks.length}件\n`);
  
  let movedCount = 0;
  let skippedCount = 0;
  
  for (const task of tasks) {
    console.log(`[${task.id}] RunID: ${task.runId}`);
    console.log(`  ステータス: ${task.status}`);
    console.log(`  コンテナID: ${task.container_id || 'なし'}`);
    console.log(`  現在のキュー: ${task.queue_name}`);
    
    // 実行中のタスクはスキップ（安全のため）
    if (task.status === 'running') {
      console.log(`  ⚠️ 実行中のタスクのためスキップします`);
      skippedCount++;
      continue;
    }
    
    // データベースを更新（queue_nameをqueue4に変更）
    try {
      const now = Date.now();
      
      run(
        `UPDATE tasks 
         SET queue_name = ?, updated_at = ?
         WHERE id = ?`,
        [QUEUE_4_NAME, now, task.id]
      );
      
      console.log(`  ✅ 移動完了: ${QUEUE_2_NAME} → ${QUEUE_4_NAME}`);
      movedCount++;
    } catch (e: any) {
      console.error(`  ❌ 移動失敗: ${e.message}`);
      skippedCount++;
    }
    
    console.log('');
  }
  
  console.log('=== 完了 ===');
  console.log(`  移動: ${movedCount}件`);
  console.log(`  スキップ: ${skippedCount}件`);
  console.log(`  合計: ${tasks.length}件`);
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});











