import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'storage', 'app.db');
const db = new Database(dbPath);

// tasks テーブルのスキーマ確認
console.log('=== tasks テーブルのカラム ===');
const schema = db.prepare('PRAGMA table_info(tasks)').all();
schema.forEach(col => console.log(`  - ${col.name} (${col.type})`));

console.log('\n=== プリセット32 の最近のタスク ===');
const tasks = db.prepare(`
  SELECT 
    id,
    runId,
    preset_id,
    container_id,
    overrides_json,
    queue_name,
    status,
    created_at
  FROM tasks
  WHERE preset_id = 32
  ORDER BY created_at DESC
  LIMIT 10
`).all();

tasks.forEach((task, idx) => {
  console.log(`\n【タスク ${idx + 1}】`);
  console.log(`  runId: ${task.runId}`);
  console.log(`  containerId: ${task.container_id}`);
  console.log(`  queue: ${task.queue_name}`);
  console.log(`  status: ${task.status}`);
  console.log(`  created_at: ${new Date(task.created_at).toISOString()}`);
  
  // overrides_json を解析
  try {
    const overrides = task.overrides_json ? JSON.parse(task.overrides_json) : {};
    console.log(`  overrides:`);
    console.log(`    post_library_id: ${overrides.post_library_id || '（未指定）'}`);
    // その他のキーも表示
    const keys = Object.keys(overrides).filter(k => k !== 'post_library_id');
    if (keys.length > 0) {
      console.log(`    その他: ${keys.join(', ')}`);
    }
  } catch (e) {
    console.log(`    overrides_json parse error: ${String(e)}`);
  }
});

if (tasks.length === 0) {
  console.log('\nプリセット32のタスクが見つかりません');
}

db.close();
