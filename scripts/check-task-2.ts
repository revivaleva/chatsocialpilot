import 'dotenv/config';
import { initDb, query } from '../src/drivers/db';

initDb({ wal: true });

// タスク2を取得
const tasks = query<any>(
  'SELECT id, runId, preset_id, container_id, overrides_json, status, created_at FROM tasks WHERE id = ?',
  [2]
);

if (tasks.length === 0) {
  console.log('タスクID 2が見つかりません');
  process.exit(1);
}

const task = tasks[0];
console.log('タスク2の情報:');
console.log(`  ID: ${task.id}`);
console.log(`  RunID: ${task.runId}`);
console.log(`  プリセットID: ${task.preset_id}`);
console.log(`  コンテナID: ${task.container_id}`);
console.log(`  ステータス: ${task.status}`);
console.log(`  作成日時: ${new Date(task.created_at).toISOString()}`);

// overrides_jsonをパース
let overrides: any = {};
if (task.overrides_json) {
  try {
    overrides = JSON.parse(task.overrides_json);
    console.log('\n現在のパラメータ (overrides_json):');
    console.log(JSON.stringify(overrides, null, 2));
  } catch (e) {
    console.log('\noverrides_jsonのパースに失敗しました:', e);
  }
} else {
  console.log('\noverrides_jsonが設定されていません');
}

// プリセット情報も確認
if (task.preset_id) {
  const presets = query<any>(
    'SELECT id, name, description FROM presets WHERE id = ?',
    [task.preset_id]
  );
  if (presets.length > 0) {
    console.log(`\nプリセット: [${presets[0].id}] ${presets[0].name}`);
  }
}











