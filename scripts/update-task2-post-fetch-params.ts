import 'dotenv/config';
import { initDb, query, run } from '../src/drivers/db';

/**
 * タスク2（queue2）に登録されている投稿取得タスク（プリセットID 28）の
 * パラメータを更新するスクリプト
 * 
 * 変更内容:
 * - repeat_count: 5
 * - max_posts: 20
 * - batch_size: 5
 */

const QUEUE_2_NAME = 'queue2';
const POST_FETCH_PRESET_ID = 28; // Threads検索・投稿取得プリセット

const NEW_PARAMS = {
  repeat_count: 5,
  max_posts: 20,
  batch_size: 5,
};

async function main() {
  initDb({ wal: true });
  
  console.log('=== タスク2の投稿取得タスクのパラメータ更新 ===\n');
  console.log(`対象キュー: ${QUEUE_2_NAME}`);
  console.log(`対象プリセットID: ${POST_FETCH_PRESET_ID}`);
  console.log(`新しいパラメータ:`);
  console.log(JSON.stringify(NEW_PARAMS, null, 2));
  console.log('');
  
  // タスク2に登録されているプリセット28のタスクをすべて検索
  // tasksテーブルにはqueueNameが直接保存されていないため、
  // scheduled_atが設定されているタスクで、プリセットID 28のものを対象とする
  // （実際には、queueNameは実行時に決定されるため、pending/waiting状態のタスクを対象とする）
  
  const tasks = query<any>(
    `SELECT id, runId, preset_id, container_id, overrides_json, status, scheduled_at, created_at
     FROM tasks
     WHERE preset_id = ?
       AND status IN ('pending', 'waiting', 'waiting_failed', 'waiting_stopped')
     ORDER BY created_at DESC`,
    [POST_FETCH_PRESET_ID]
  );
  
  if (tasks.length === 0) {
    console.log('✅ タスク2でプリセット28が使用されているタスクはありません');
    return;
  }
  
  console.log(`対象タスク数: ${tasks.length}件\n`);
  
  let updatedCount = 0;
  let skippedCount = 0;
  
  for (const task of tasks) {
    console.log(`[${task.id}] RunID: ${task.runId}`);
    console.log(`  ステータス: ${task.status}`);
    console.log(`  コンテナID: ${task.container_id || 'なし'}`);
    
    // 現在のoverrides_jsonをパース
    let currentOverrides: any = {};
    if (task.overrides_json) {
      try {
        currentOverrides = JSON.parse(task.overrides_json);
      } catch (e) {
        console.log(`  ⚠️ overrides_jsonのパースに失敗: ${e}`);
        skippedCount++;
        continue;
      }
    }
    
    console.log(`  現在のパラメータ:`);
    console.log(`    repeat_count: ${currentOverrides.repeat_count || '未設定'}`);
    console.log(`    max_posts: ${currentOverrides.max_posts || '未設定'}`);
    console.log(`    batch_size: ${currentOverrides.batch_size || '未設定'}`);
    
    // 新しいパラメータをマージ（既存のパラメータは保持）
    const updatedOverrides = {
      ...currentOverrides,
      ...NEW_PARAMS,
    };
    
    // 変更があるか確認
    const hasChanges = 
      currentOverrides.repeat_count !== NEW_PARAMS.repeat_count ||
      currentOverrides.max_posts !== NEW_PARAMS.max_posts ||
      currentOverrides.batch_size !== NEW_PARAMS.batch_size;
    
    if (!hasChanges) {
      console.log(`  ✅ 既に同じパラメータが設定されています`);
      skippedCount++;
      continue;
    }
    
    // データベースを更新
    try {
      const updatedJson = JSON.stringify(updatedOverrides);
      const now = Date.now();
      
      run(
        `UPDATE tasks 
         SET overrides_json = ?, updated_at = ?
         WHERE id = ?`,
        [updatedJson, now, task.id]
      );
      
      console.log(`  ✅ 更新完了`);
      console.log(`    新しいパラメータ:`);
      console.log(`      repeat_count: ${updatedOverrides.repeat_count}`);
      console.log(`      max_posts: ${updatedOverrides.max_posts}`);
      console.log(`      batch_size: ${updatedOverrides.batch_size}`);
      updatedCount++;
    } catch (e: any) {
      console.error(`  ❌ 更新失敗: ${e.message}`);
      skippedCount++;
    }
    
    console.log('');
  }
  
  console.log('=== 完了 ===');
  console.log(`  更新: ${updatedCount}件`);
  console.log(`  スキップ: ${skippedCount}件`);
  console.log(`  合計: ${tasks.length}件`);
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});











