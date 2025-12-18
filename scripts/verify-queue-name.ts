import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.resolve('storage', 'app.db');

try {
  const db = new Database(DB_PATH, { readonly: true });
  
  // 作成したタスクの詳細を確認
  console.log('=== 作成したタスク（follower-で始まるrunId）の詳細 ===\n');
  
  const tasks = db.prepare(`
    SELECT 
      id,
      runId,
      preset_id,
      container_id,
      status,
      queue_name,
      group_id,
      wait_minutes,
      created_at
    FROM tasks
    WHERE runId LIKE 'follower-%'
    ORDER BY created_at DESC
  `).all() as Array<any>;
  
  console.log(`タスク数: ${tasks.length}件\n`);
  
  if (tasks.length > 0) {
    const task = tasks[0];
    console.log('最初のタスク詳細:');
    Object.entries(task).forEach(([key, value]) => {
      console.log(`  ${key}: ${value} (型: ${typeof value})`);
    });
  }
  
  // すべてのqueue_nameのユニーク値を取得
  console.log('\n=== DB内のすべてのqueue_name ===\n');
  const queueNames = db.prepare(`
    SELECT DISTINCT queue_name, COUNT(*) as count
    FROM tasks
    GROUP BY queue_name
    ORDER BY queue_name
  `).all() as Array<{queue_name: string | null; count: number}>;
  
  queueNames.forEach(q => {
    console.log(`  queue_name: "${q.queue_name}" (${q.count}件)`);
  });
  
  // tasksテーブルのスキーマを確認
  console.log('\n=== tasksテーブルのスキーマ ===\n');
  const schema = db.prepare(`
    PRAGMA table_info(tasks)
  `).all() as Array<{cid: number; name: string; type: string; notnull: number; dflt_value: any; pk: number}>;
  
  schema.forEach(col => {
    console.log(`  ${col.name}: ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.pk ? ' PRIMARY KEY' : ''}`);
  });
  
  // APIの実装確認用にキューが何になっているか全件確認
  console.log('\n=== status != "done" AND queue_name = "task1" のタスク ===\n');
  const task1Tasks = db.prepare(`
    SELECT COUNT(*) as count
    FROM tasks
    WHERE status != 'done' AND queue_name = 'task1'
  `).get() as {count: number};
  
  console.log(`件数: ${task1Tasks.count}件`);
  
  // デフォルトキューでのタスク確認
  console.log('\n=== デフォルトキュー（NULL または "default"）での pending タスク ===\n');
  const defaultTasks = db.prepare(`
    SELECT COUNT(*) as count
    FROM tasks
    WHERE status = 'pending' AND (queue_name IS NULL OR queue_name = 'default')
  `).get() as {count: number};
  
  console.log(`件数: ${defaultTasks.count}件`);
  
  db.close();
} catch (e: any) {
  console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
}











