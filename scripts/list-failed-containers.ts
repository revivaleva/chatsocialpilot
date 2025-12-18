import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = path.resolve('storage', 'app.db');
const db = new Database(DB_PATH);

console.log('=== 15日以降で一度も成功していないコンテナのリストアップ ===\n');

// 15日以降に実行されたタスクのコンテナIDを取得
const date15 = new Date('2025-12-15T00:00:00Z').getTime();

// 15日以降に実行された全コンテナID（重複除去）
const containersAfter15 = db.prepare(`
  SELECT DISTINCT container_id
  FROM tasks
  WHERE scheduled_at IS NOT NULL
    AND scheduled_at >= ?
    AND container_id IS NOT NULL
`).all(date15) as { container_id: string }[];

console.log(`15日以降に実行されたコンテナ数: ${containersAfter15.length}件\n`);

// 各コンテナで15日以降に成功したタスクがあるかチェック
const failedContainers: Array<{
  container_id: string;
  total_tasks: number;
  done_tasks: number;
  pending_tasks: number;
  failed_tasks: number;
  last_status: string;
  last_scheduled: number | null;
}> = [];

for (const row of containersAfter15) {
  const containerId = row.container_id;
  
  // 15日以降のタスク統計
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status IN ('stopped', 'cancelled', 'waiting_stopped') THEN 1 ELSE 0 END) as failed,
      MAX(scheduled_at) as last_scheduled
    FROM tasks
    WHERE container_id = ?
      AND scheduled_at IS NOT NULL
      AND scheduled_at >= ?
  `).get(containerId, date15) as {
    total: number;
    done: number;
    pending: number;
    failed: number;
    last_scheduled: number | null;
  };
  
  // 成功したタスクが0件の場合
  if (stats.done === 0) {
    // 最後のステータスを取得
    const lastTask = db.prepare(`
      SELECT status
      FROM tasks
      WHERE container_id = ?
        AND scheduled_at IS NOT NULL
        AND scheduled_at >= ?
      ORDER BY scheduled_at DESC
      LIMIT 1
    `).get(containerId, date15) as { status: string } | undefined;
    
    failedContainers.push({
      container_id: containerId,
      total_tasks: stats.total,
      done_tasks: stats.done,
      pending_tasks: stats.pending,
      failed_tasks: stats.failed,
      last_status: lastTask?.status || 'unknown',
      last_scheduled: stats.last_scheduled,
    });
  }
}

console.log(`一度も成功していないコンテナ数: ${failedContainers.length}件\n`);

// ステータス別に集計
const statusCounts: Record<string, number> = {};
for (const container of failedContainers) {
  statusCounts[container.last_status] = (statusCounts[container.last_status] || 0) + 1;
}

console.log('【最後のステータス別集計】');
for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status}: ${count}件`);
}
console.log();

// タスク数別に集計
const taskCountRanges = {
  '1件': 0,
  '2-3件': 0,
  '4-5件': 0,
  '6件以上': 0,
};

for (const container of failedContainers) {
  if (container.total_tasks === 1) {
    taskCountRanges['1件']++;
  } else if (container.total_tasks <= 3) {
    taskCountRanges['2-3件']++;
  } else if (container.total_tasks <= 5) {
    taskCountRanges['4-5件']++;
  } else {
    taskCountRanges['6件以上']++;
  }
}

console.log('【タスク数別集計】');
for (const [range, count] of Object.entries(taskCountRanges)) {
  console.log(`  ${range}: ${count}件`);
}
console.log();

// 詳細リスト（上位50件）
console.log('【詳細リスト（上位50件）】');
const sortedContainers = failedContainers.sort((a, b) => {
  // まずタスク数でソート（多い順）、次に最後のスケジュール日でソート（新しい順）
  if (b.total_tasks !== a.total_tasks) {
    return b.total_tasks - a.total_tasks;
  }
  return (b.last_scheduled || 0) - (a.last_scheduled || 0);
});

for (let i = 0; i < Math.min(50, sortedContainers.length); i++) {
  const c = sortedContainers[i];
  const lastDate = c.last_scheduled ? new Date(c.last_scheduled).toISOString().substring(0, 10) : 'N/A';
  console.log(`  ${i + 1}. ${c.container_id.substring(0, 8)}... | タスク: ${c.total_tasks}件 (done: ${c.done_tasks}, pending: ${c.pending_tasks}, failed: ${c.failed_tasks}) | 最終ステータス: ${c.last_status} | 最終スケジュール: ${lastDate}`);
}

if (sortedContainers.length > 50) {
  console.log(`  ... 他 ${sortedContainers.length - 50}件`);
}

console.log();

// 全コンテナIDのリスト（CSV形式）
console.log('【全コンテナIDリスト（CSV形式）】');
console.log('container_id,total_tasks,done_tasks,pending_tasks,failed_tasks,last_status,last_scheduled');
for (const c of sortedContainers) {
  const lastDate = c.last_scheduled ? new Date(c.last_scheduled).toISOString() : '';
  console.log(`${c.container_id},${c.total_tasks},${c.done_tasks},${c.pending_tasks},${c.failed_tasks},${c.last_status},${lastDate}`);
}

db.close();

