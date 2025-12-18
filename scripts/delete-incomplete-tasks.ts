import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = path.resolve('storage', 'app.db');
const db = new Database(DB_PATH);

console.log('=== 未完了タスクの削除 ===\n');

// 削除対象のタスクを確認
// 1. 14日の未完了タスク（pending, stopped, running, waiting_stopped）
const target14 = db.prepare(`
  SELECT 
    COUNT(*) as count,
    status,
    DATE(datetime(scheduled_at/1000, 'unixepoch')) as date,
    CASE 
      WHEN CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 0 THEN '09:00'
      WHEN CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 8 THEN '17:00'
      ELSE 'Other'
    END as time
  FROM tasks
  WHERE scheduled_at IS NOT NULL
    AND DATE(datetime(scheduled_at/1000, 'unixepoch')) = '2025-12-14'
    AND status IN ('pending', 'stopped', 'running', 'waiting_stopped')
  GROUP BY status, time
`).all() as { count: number, status: string, date: string, time: string }[];

console.log('【削除対象1: 14日の未完了タスク】');
let total14 = 0;
for (const stat of target14) {
  console.log(`  ${stat.date} ${stat.time} ${stat.status}: ${stat.count}件`);
  total14 += stat.count;
}
console.log(`  合計: ${total14}件\n`);

// 2. 15日9時の未完了タスク
const target15_09 = db.prepare(`
  SELECT 
    COUNT(*) as count,
    status
  FROM tasks
  WHERE scheduled_at IS NOT NULL
    AND DATE(datetime(scheduled_at/1000, 'unixepoch')) = '2025-12-15'
    AND CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 0
    AND status IN ('pending', 'stopped', 'running', 'waiting_stopped')
  GROUP BY status
`).all() as { count: number, status: string }[];

console.log('【削除対象2: 15日9時の未完了タスク】');
let total15_09 = 0;
for (const stat of target15_09) {
  console.log(`  ${stat.status}: ${stat.count}件`);
  total15_09 += stat.count;
}
console.log(`  合計: ${total15_09}件\n`);

// 3. 15日17時の未完了タスク（確認用、削除しない）
const keep15_17 = db.prepare(`
  SELECT 
    COUNT(*) as count,
    status
  FROM tasks
  WHERE scheduled_at IS NOT NULL
    AND DATE(datetime(scheduled_at/1000, 'unixepoch')) = '2025-12-15'
    AND CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 8
    AND status IN ('pending', 'stopped', 'running', 'waiting_stopped')
  GROUP BY status
`).all() as { count: number, status: string }[];

console.log('【保持: 15日17時の未完了タスク（削除しない）】');
let total15_17 = 0;
for (const stat of keep15_17) {
  console.log(`  ${stat.status}: ${stat.count}件`);
  total15_17 += stat.count;
}
console.log(`  合計: ${total15_17}件\n`);

const totalDelete = total14 + total15_09;
console.log(`=== 削除予定: 合計 ${totalDelete}件 ===\n`);

// 削除実行
if (totalDelete > 0) {
  console.log('削除を実行します...\n');
  
  // 14日の未完了タスクを削除
  const deleted14 = db.prepare(`
    DELETE FROM tasks
    WHERE scheduled_at IS NOT NULL
      AND DATE(datetime(scheduled_at/1000, 'unixepoch')) = '2025-12-14'
      AND status IN ('pending', 'stopped', 'running', 'waiting_stopped')
  `).run();
  
  console.log(`✓ 14日の未完了タスク: ${deleted14.changes}件削除`);
  
  // 15日9時の未完了タスクを削除
  const deleted15_09 = db.prepare(`
    DELETE FROM tasks
    WHERE scheduled_at IS NOT NULL
      AND DATE(datetime(scheduled_at/1000, 'unixepoch')) = '2025-12-15'
      AND CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 0
      AND status IN ('pending', 'stopped', 'running', 'waiting_stopped')
  `).run();
  
  console.log(`✓ 15日9時の未完了タスク: ${deleted15_09.changes}件削除`);
  
  console.log(`\n=== 削除完了: 合計 ${deleted14.changes + deleted15_09.changes}件削除しました ===`);
  
  // 削除後の確認
  console.log('\n【削除後の確認】');
  const remaining14 = db.prepare(`
    SELECT COUNT(*) as count
    FROM tasks
    WHERE scheduled_at IS NOT NULL
      AND DATE(datetime(scheduled_at/1000, 'unixepoch')) = '2025-12-14'
      AND status IN ('pending', 'stopped', 'running', 'waiting_stopped')
  `).get() as { count: number };
  
  const remaining15_09 = db.prepare(`
    SELECT COUNT(*) as count
    FROM tasks
    WHERE scheduled_at IS NOT NULL
      AND DATE(datetime(scheduled_at/1000, 'unixepoch')) = '2025-12-15'
      AND CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 0
      AND status IN ('pending', 'stopped', 'running', 'waiting_stopped')
  `).get() as { count: number };
  
  const remaining15_17 = db.prepare(`
    SELECT COUNT(*) as count
    FROM tasks
    WHERE scheduled_at IS NOT NULL
      AND DATE(datetime(scheduled_at/1000, 'unixepoch')) = '2025-12-15'
      AND CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 8
      AND status IN ('pending', 'stopped', 'running', 'waiting_stopped')
  `).get() as { count: number };
  
  console.log(`  14日の未完了タスク残り: ${remaining14.count}件`);
  console.log(`  15日9時の未完了タスク残り: ${remaining15_09.count}件`);
  console.log(`  15日17時の未完了タスク残り: ${remaining15_17.count}件（保持）`);
} else {
  console.log('削除対象のタスクはありませんでした。');
}

db.close();

