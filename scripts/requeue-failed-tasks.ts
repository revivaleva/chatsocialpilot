import { initDb, query, run } from '../src/drivers/db';
import { enqueueTask } from '../src/services/taskQueue';

initDb({ wal: true });

// 今日の日付範囲を計算（日本時間基準）
const now = new Date();
const jstOffset = 9 * 60 * 60 * 1000;
const jstNow = new Date(now.getTime() + jstOffset);
const today = new Date(jstNow);
today.setUTCHours(0, 0, 0, 0);
const todayStart = today.getTime() - jstOffset;
const todayEnd = todayStart + 24 * 60 * 60 * 1000;

console.log(`\n=== 失敗タスクの再登録 ===`);
console.log(`分析期間: ${new Date(todayStart).toISOString()} ～ ${new Date(todayEnd).toISOString()}`);

// 今日失敗・停止した「いいね3点セット」のタスクを取得
const failedTasks = query(`
  SELECT 
    t.id,
    t.runId,
    t.preset_id,
    p.name as preset_name,
    t.container_id,
    t.overrides_json,
    t.group_id,
    cg.name as group_name,
    t.status as task_status,
    tr.status as run_status
  FROM tasks t
  LEFT JOIN presets p ON t.preset_id = p.id
  LEFT JOIN container_groups cg ON t.group_id = cg.id
  LEFT JOIN task_runs tr ON t.runId = tr.runId
  WHERE p.name LIKE '%いいね3点セット%'
    AND t.created_at >= ?
    AND t.created_at < ?
    AND (
      t.status IN ('failed', 'stopped', 'waiting_failed', 'waiting_stopped')
      OR tr.status IN ('failed', 'stopped', 'waiting_failed', 'waiting_stopped')
    )
  ORDER BY t.created_at DESC
`, [todayStart, todayEnd]);

if (!failedTasks || failedTasks.length === 0) {
  console.log('\n再登録する失敗タスクがありませんでした。');
  process.exit(0);
}

console.log(`\n失敗タスク数: ${failedTasks.length}件`);

// タスクを再登録
let successCount = 0;
let errorCount = 0;
const errors: string[] = [];

for (const task of failedTasks) {
  try {
    const presetId = Number(task.preset_id);
    const containerId = task.container_id ? String(task.container_id) : undefined;
    const groupId = task.group_id ? String(task.group_id) : undefined;
    
    // overrides_jsonをパース
    let overrides: any = {};
    if (task.overrides_json) {
      try {
        overrides = JSON.parse(task.overrides_json);
      } catch (e) {
        console.warn(`  RunID ${task.runId}: overrides_jsonのパースに失敗しました`);
      }
    }
    
    // 新しいタスクとして登録（defaultキューに）
    const newRunId = enqueueTask({
      presetId,
      containerId,
      overrides,
      groupId,
      waitMinutes: 0, // 待機時間は0（即座に実行）
    }, 'default');
    
    console.log(`  ✓ 再登録成功: ${task.preset_name} (RunID: ${newRunId}, 元RunID: ${task.runId})`);
    successCount++;
  } catch (e: any) {
    const errorMsg = `RunID ${task.runId}: ${String(e?.message || e)}`;
    console.error(`  ✗ 再登録失敗: ${errorMsg}`);
    errors.push(errorMsg);
    errorCount++;
  }
}

console.log(`\n=== 再登録結果 ===`);
console.log(`  成功: ${successCount}件`);
console.log(`  失敗: ${errorCount}件`);

if (errors.length > 0) {
  console.log(`\n=== エラー詳細 ===`);
  for (const error of errors) {
    console.log(`  - ${error}`);
  }
}

console.log(`\n再登録が完了しました。タスク1（defaultキュー）に ${successCount}件のタスクが追加されました。`);











