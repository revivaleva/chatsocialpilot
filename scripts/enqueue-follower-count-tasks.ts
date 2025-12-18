import { initDb, query } from '../src/drivers/db';
import { enqueueTask } from '../src/services/taskQueue';

initDb({ wal: true });

// follower_countがNULLで、直近の「いいね3点セット」が失敗/停止しているアカウントを取得
// 各アカウントごとに最新の実行結果のみを取得
const results = query(`
  WITH latest_tasks AS (
    SELECT 
      xa.container_id,
      xa.email,
      xa.x_username,
      xa.follower_count,
      t.runId,
      t.status as task_status,
      tr.status as run_status,
      t.created_at,
      tr.ended_at,
      p.name as preset_name,
      t.group_id,
      ROW_NUMBER() OVER (PARTITION BY xa.container_id ORDER BY t.created_at DESC) as rn
    FROM x_accounts xa
    LEFT JOIN tasks t ON xa.container_id = t.container_id
    LEFT JOIN presets p ON t.preset_id = p.id
    LEFT JOIN task_runs tr ON t.runId = tr.runId
    WHERE xa.follower_count IS NULL
      AND p.name LIKE '%いいね3点セット%'
      AND (
        t.status IN ('failed', 'stopped', 'waiting_failed', 'waiting_stopped')
        OR tr.status IN ('failed', 'stopped', 'waiting_failed', 'waiting_stopped')
      )
  )
  SELECT DISTINCT
    container_id,
    email,
    x_username,
    group_id
  FROM latest_tasks
  WHERE rn = 1
  ORDER BY created_at DESC
`);

console.log('=== follower_countがNULLで、直近の「いいね3点セット」が失敗/停止しているアカウント ===\n');
console.log('対象アカウント数:', results.length);

if (results.length === 0) {
  console.log('\n該当するアカウントはありませんでした。');
  process.exit(0);
}

// プリセットID 29（フォロワー数取得・保存）のタスクを登録
const PRESET_ID = 29;
const QUEUE_NAME = 'default'; // タスク1

console.log(`\nプリセットID ${PRESET_ID}（フォロワー数取得・保存）のタスクをタスク1（${QUEUE_NAME}キュー）に登録します...\n`);

let successCount = 0;
let errorCount = 0;
const errors: string[] = [];

for (const account of results as any[]) {
  try {
    const containerId = account.container_id;
    const groupId = account.group_id ? String(account.group_id) : undefined;
    
    // タスクを登録
    const newRunId = enqueueTask({
      presetId: PRESET_ID,
      containerId: containerId,
      overrides: {},
      groupId: groupId,
      waitMinutes: 0, // 待機時間は0（即座に実行）
    }, QUEUE_NAME);
    
    console.log(`  ✓ 登録成功: container_id=${containerId}, email=${account.email || 'N/A'}, RunID=${newRunId}`);
    successCount++;
  } catch (e: any) {
    const errorMsg = `container_id=${account.container_id}: ${String(e?.message || e)}`;
    console.error(`  ✗ 登録失敗: ${errorMsg}`);
    errors.push(errorMsg);
    errorCount++;
  }
}

console.log(`\n=== 登録結果 ===`);
console.log(`  成功: ${successCount}件`);
console.log(`  失敗: ${errorCount}件`);

if (errors.length > 0) {
  console.log(`\n=== エラー詳細 ===`);
  for (const error of errors) {
    console.log(`  - ${error}`);
  }
}

console.log(`\nタスク登録が完了しました。タスク1（${QUEUE_NAME}キュー）に ${successCount}件のタスクが追加されました。`);

