import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = path.resolve('storage', 'app.db');
const db = new Database(DB_PATH);

console.log('=== 朝9時指定タスクの削除 ===\n');

// 削除対象のタスクを確認（朝9時 = UTC 0:00）
const targetTasks = db.prepare(`
  SELECT 
    DATE(datetime(scheduled_at/1000, 'unixepoch')) as date,
    status,
    COUNT(*) as count
  FROM tasks
  WHERE scheduled_at IS NOT NULL
    AND CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 0
  GROUP BY date, status
  ORDER BY date, status
`).all() as { date: string, status: string, count: number }[];

console.log('【削除対象: 朝9時（UTC 0:00）のタスク】');
let totalCount = 0;
for (const stat of targetTasks) {
  console.log(`  ${stat.date} ${stat.status}: ${stat.count}件`);
  totalCount += stat.count;
}
console.log(`  合計: ${totalCount}件\n`);

if (totalCount === 0) {
  console.log('削除対象のタスクはありませんでした。');
  db.close();
  process.exit(0);
}

// 削除実行
console.log('削除を実行します...\n');

const deleted = db.prepare(`
  DELETE FROM tasks
  WHERE scheduled_at IS NOT NULL
    AND CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 0
`).run();

console.log(`✓ 朝9時指定のタスク: ${deleted.changes}件削除しました\n`);

// 削除後の確認
const remaining = db.prepare(`
  SELECT COUNT(*) as count
  FROM tasks
  WHERE scheduled_at IS NOT NULL
    AND CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 0
`).get() as { count: number };

console.log(`【削除後の確認】`);
console.log(`  朝9時指定のタスク残り: ${remaining.count}件`);

// 日付別の残りタスク（夜17時のみ）
const remainingByDate = db.prepare(`
  SELECT 
    DATE(datetime(scheduled_at/1000, 'unixepoch')) as date,
    COUNT(*) as count
  FROM tasks
  WHERE scheduled_at IS NOT NULL
    AND CAST(strftime('%H', datetime(scheduled_at/1000, 'unixepoch')) AS INTEGER) = 8
  GROUP BY date
  ORDER BY date
`).all() as { date: string, count: number }[];

if (remainingByDate.length > 0) {
  console.log(`\n【夜17時指定のタスク（残存）】`);
  for (const stat of remainingByDate) {
    console.log(`  ${stat.date}: ${stat.count}件`);
  }
}

db.close();







