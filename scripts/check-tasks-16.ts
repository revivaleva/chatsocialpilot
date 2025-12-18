import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = path.resolve('storage', 'app.db');
const db = new Database(DB_PATH);

// 16日のタスクを確認
const tasks = db.prepare(`
  SELECT 
    t.runId,
    t.preset_id,
    t.container_id,
    t.scheduled_at,
    t.queue_name,
    t.status,
    p.name as preset_name
  FROM tasks t
  LEFT JOIN presets p ON t.preset_id = p.id
  WHERE DATE(datetime(t.scheduled_at/1000, 'unixepoch')) = '2025-12-16'
  ORDER BY t.scheduled_at, t.queue_name, t.preset_id
`).all() as { runId: string, preset_id: number, container_id: string, scheduled_at: number, queue_name: string, status: string, preset_name: string }[];

console.log(`=== 16日のタスク一覧 (合計 ${tasks.length}件) ===\n`);

// 時間帯とプリセット別に集計
const stats: Record<string, Record<string, number>> = {};

for (const task of tasks) {
  const date = new Date(task.scheduled_at);
  const timeKey = date.getUTCHours() === 0 ? '09:00' : '17:00';
  const presetKey = `${task.preset_id} (${task.preset_name || 'Unknown'})`;
  
  if (!stats[timeKey]) {
    stats[timeKey] = {};
  }
  stats[timeKey][presetKey] = (stats[timeKey][presetKey] || 0) + 1;
}

for (const [time, presets] of Object.entries(stats)) {
  console.log(`${time}:`);
  for (const [preset, count] of Object.entries(presets)) {
    console.log(`  ${preset}: ${count}件`);
  }
  console.log();
}

// キュー別の統計
const queueStats = db.prepare(`
  SELECT queue_name, COUNT(*) as count
  FROM tasks
  WHERE DATE(datetime(scheduled_at/1000, 'unixepoch')) = '2025-12-16'
  GROUP BY queue_name
  ORDER BY queue_name
`).all() as { queue_name: string, count: number }[];

console.log('=== キュー別統計 ===');
for (const stat of queueStats) {
  console.log(`${stat.queue_name}: ${stat.count}件`);
}

// ステータス別の統計
const statusStats = db.prepare(`
  SELECT status, COUNT(*) as count
  FROM tasks
  WHERE DATE(datetime(scheduled_at/1000, 'unixepoch')) = '2025-12-16'
  GROUP BY status
  ORDER BY status
`).all() as { status: string, count: number }[];

console.log('\n=== ステータス別統計 ===');
for (const stat of statusStats) {
  console.log(`${stat.status}: ${stat.count}件`);
}

db.close();

