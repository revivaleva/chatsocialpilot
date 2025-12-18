import { initDb, query } from '../src/drivers/db';

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
  SELECT 
    container_id,
    email,
    x_username,
    follower_count,
    runId,
    task_status,
    run_status,
    created_at,
    ended_at,
    preset_name
  FROM latest_tasks
  WHERE rn = 1
  ORDER BY created_at DESC
`);

console.log('=== follower_countがNULLで、直近の「いいね3点セット」が失敗/停止しているアカウント ===\n');

// 統計情報
const failedCount = results.filter((r: any) => r.run_status === 'failed').length;
const stoppedCount = results.filter((r: any) => r.run_status === 'stopped').length;
const waitingFailedCount = results.filter((r: any) => r.run_status === 'waiting_failed').length;
const waitingStoppedCount = results.filter((r: any) => r.run_status === 'waiting_stopped').length;

console.log('総件数:', results.length);
console.log('  - failed:', failedCount);
console.log('  - stopped:', stoppedCount);
console.log('  - waiting_failed:', waitingFailedCount);
console.log('  - waiting_stopped:', waitingStoppedCount);
console.log('');

if (results.length > 0) {
  console.log('詳細:');
  results.forEach((r: any, i: number) => {
    console.log(`${i + 1}. container_id: ${r.container_id}`);
    console.log(`   メール: ${r.email || 'N/A'}`);
    console.log(`   ユーザー名: ${r.x_username || 'N/A'}`);
    console.log(`   プリセット: ${r.preset_name || 'N/A'}`);
    console.log(`   RunID: ${r.runId || 'N/A'}`);
    console.log(`   タスクステータス: ${r.task_status || 'N/A'}`);
    console.log(`   実行ステータス: ${r.run_status || 'N/A'}`);
    console.log(`   作成日時: ${r.created_at ? new Date(r.created_at).toISOString() : 'N/A'}`);
    console.log(`   終了日時: ${r.ended_at ? new Date(r.ended_at).toISOString() : 'N/A'}`);
    console.log('');
  });
} else {
  console.log('\n該当するアカウントはありませんでした。');
}

