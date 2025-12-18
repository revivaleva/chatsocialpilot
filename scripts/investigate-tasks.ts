import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = path.resolve('storage', 'app.db');
const db = new Database(DB_PATH);

console.log('=== タスク登録状況の調査 ===\n');

// 1. ステータス別のタスク数
console.log('【1. ステータス別タスク数】');
const statusStats = db.prepare(`
  SELECT status, COUNT(*) as count
  FROM tasks
  GROUP BY status
  ORDER BY count DESC
`).all() as { status: string, count: number }[];

for (const stat of statusStats) {
  console.log(`  ${stat.status}: ${stat.count}件`);
}
console.log();

// 2. 日付別のタスク数（scheduled_atが設定されているもの）
console.log('【2. スケジュール日別タスク数】');
const dateStats = db.prepare(`
  SELECT 
    DATE(datetime(scheduled_at/1000, 'unixepoch')) as date,
    COUNT(*) as count
  FROM tasks
  WHERE scheduled_at IS NOT NULL
  GROUP BY date
  ORDER BY date
`).all() as { date: string, count: number }[];

for (const stat of dateStats) {
  console.log(`  ${stat.date}: ${stat.count}件`);
}
console.log();

// 3. プリセット別のタスク数
console.log('【3. プリセット別タスク数】');
const presetStats = db.prepare(`
  SELECT 
    t.preset_id,
    p.name as preset_name,
    COUNT(*) as count
  FROM tasks t
  LEFT JOIN presets p ON t.preset_id = p.id
  GROUP BY t.preset_id
  ORDER BY count DESC
`).all() as { preset_id: number, preset_name: string, count: number }[];

for (const stat of presetStats) {
  console.log(`  P${stat.preset_id} (${stat.preset_name || 'Unknown'}): ${stat.count}件`);
}
console.log();

// 4. キュー別のタスク数
console.log('【4. キュー別タスク数】');
const queueStats = db.prepare(`
  SELECT 
    queue_name,
    COUNT(*) as count
  FROM tasks
  GROUP BY queue_name
  ORDER BY queue_name
`).all() as { queue_name: string, count: number }[];

for (const stat of queueStats) {
  console.log(`  ${stat.queue_name || 'NULL'}: ${stat.count}件`);
}
console.log();

// 5. 重複タスクの確認（同じpreset_id, container_id, scheduled_atの組み合わせ）
console.log('【5. 重複タスクの確認】');
const duplicates = db.prepare(`
  SELECT 
    preset_id,
    container_id,
    scheduled_at,
    COUNT(*) as count
  FROM tasks
  WHERE scheduled_at IS NOT NULL
  GROUP BY preset_id, container_id, scheduled_at
  HAVING COUNT(*) > 1
  ORDER BY count DESC
  LIMIT 20
`).all() as { preset_id: number, container_id: string, scheduled_at: number, count: number }[];

if (duplicates.length > 0) {
  console.log(`  重複タスクが見つかりました: ${duplicates.length}組`);
  let totalDuplicates = 0;
  for (const dup of duplicates) {
    totalDuplicates += dup.count - 1; // 1つを残して他は重複
    const date = new Date(dup.scheduled_at);
    console.log(`    P${dup.preset_id} × ${dup.container_id.substring(0, 8)}... × ${date.toISOString()}: ${dup.count}件`);
  }
  console.log(`  合計重複数: ${totalDuplicates}件`);
} else {
  console.log('  重複タスクは見つかりませんでした');
}
console.log();

// 6. 過去のタスク（scheduled_atが過去のもの）
console.log('【6. 過去のタスク（scheduled_at < 現在）】');
const now = Date.now();
const pastTasks = db.prepare(`
  SELECT COUNT(*) as count
  FROM tasks
  WHERE scheduled_at IS NOT NULL AND scheduled_at < ?
`).get(now) as { count: number };

console.log(`  過去のタスク: ${pastTasks.count}件`);
console.log();

// 7. スケジュールなしのタスク
console.log('【7. スケジュールなしのタスク】');
const noSchedule = db.prepare(`
  SELECT COUNT(*) as count
  FROM tasks
  WHERE scheduled_at IS NULL
`).get() as { count: number };

console.log(`  スケジュールなし: ${noSchedule.count}件`);
console.log();

// 8. 詳細サンプル（最近登録されたタスク10件）
console.log('【8. 最近登録されたタスク（サンプル10件）】');
const recentTasks = db.prepare(`
  SELECT 
    t.runId,
    t.preset_id,
    t.container_id,
    t.scheduled_at,
    t.status,
    t.queue_name,
    p.name as preset_name
  FROM tasks t
  LEFT JOIN presets p ON t.preset_id = p.id
  ORDER BY t.created_at DESC
  LIMIT 10
`).all() as { runId: string, preset_id: number, container_id: string, scheduled_at: number | null, status: string, queue_name: string, preset_name: string }[];

for (const task of recentTasks) {
  const dateStr = task.scheduled_at ? new Date(task.scheduled_at).toISOString() : 'NULL';
  console.log(`  ${task.runId.substring(0, 20)}... | P${task.preset_id} | ${dateStr.substring(0, 10)} | ${task.status} | ${task.queue_name || 'NULL'}`);
}
console.log();

// 9. 12月12-15日の詳細統計
console.log('【9. 12月12-15日の詳細統計】');
const detailStats = db.prepare(`
  SELECT 
    DATE(datetime(scheduled_at/1000, 'unixepoch')) as date,
    CASE 
      WHEN CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 0 THEN '09:00'
      WHEN CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 8 THEN '17:00'
      ELSE 'Other'
    END as time,
    preset_id,
    queue_name,
    COUNT(*) as count
  FROM tasks
  WHERE scheduled_at IS NOT NULL
    AND DATE(datetime(scheduled_at/1000, 'unixepoch')) BETWEEN '2025-12-12' AND '2025-12-15'
  GROUP BY date, time, preset_id, queue_name
  ORDER BY date, time, preset_id, queue_name
`).all() as { date: string, time: string, preset_id: number, queue_name: string, count: number }[];

for (const stat of detailStats) {
  console.log(`  ${stat.date} ${stat.time} | P${stat.preset_id} | ${stat.queue_name}: ${stat.count}件`);
}

db.close();

