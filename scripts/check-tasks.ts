import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = path.resolve('storage', 'app.db');
const db = new Database(DB_PATH);

// 登録されたタスク数を確認
const stats = db.prepare(`
  SELECT 
    queue_name,
    DATE(datetime(scheduled_at/1000, 'unixepoch')) as date,
    COUNT(*) as count
  FROM tasks
  WHERE scheduled_at >= ?
  GROUP BY queue_name, date
  ORDER BY queue_name, date
`).all(new Date('2025-12-12T00:00:00Z').getTime()) as { queue_name: string, date: string, count: number }[];

console.log('=== 登録されたタスク統計 ===');
for (const stat of stats) {
  console.log(`${stat.queue_name} - ${stat.date}: ${stat.count}件`);
}

// 全体の統計
const total = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE scheduled_at >= ?').get(new Date('2025-12-12T00:00:00Z').getTime()) as { count: number };
console.log(`\n合計: ${total.count}件`);

// キュー別の合計
const queueStats = db.prepare(`
  SELECT queue_name, COUNT(*) as count
  FROM tasks
  WHERE scheduled_at >= ?
  GROUP BY queue_name
  ORDER BY queue_name
`).all(new Date('2025-12-12T00:00:00Z').getTime()) as { queue_name: string, count: number }[];

console.log('\n=== キュー別合計 ===');
for (const stat of queueStats) {
  console.log(`${stat.queue_name}: ${stat.count}件`);
}

db.close();

