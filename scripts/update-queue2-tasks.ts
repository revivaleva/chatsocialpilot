import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, query, run } from '../src/drivers/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DB初期化
initDb();

// タスク2（queue2）に登録されているプリセット28のタスクをすべて更新
const queueName = 'queue2';
const presetIdToUpdate = 28;
const presetFilePath = path.resolve(__dirname, '../presets/threads-search-example.json');

async function updateQueue2Tasks() {
  try {
    // 1. 最新のプリセットファイルを読み込み
    const presetFileContent = fs.readFileSync(presetFilePath, 'utf-8');
    const presetFromFile = JSON.parse(presetFileContent);
    const newStepsJson = JSON.stringify(presetFromFile.steps);

    console.log(`📋 更新対象のプリセット: ${presetIdToUpdate}`);
    console.log(`📋 更新対象のキュー: ${queueName}`);

    // 2. タスク2に登録されているプリセット28のタスクをすべて検索
    const tasks = query(
      'SELECT id, runId, preset_id, status, overrides_json FROM tasks WHERE queue_name = ? AND preset_id = ? AND status != ?',
      [queueName, presetIdToUpdate, 'done']
    );

    if (!tasks || tasks.length === 0) {
      console.log(`✅ タスク2でプリセット28が使用されているタスクはありません`);
      return;
    }

    console.log(`\n📊 対象タスク数: ${tasks.length}件`);
    console.log(`───────────────────────────────────────`);

    // 3. 各タスクのoverrides_jsonを取得し、stepsを更新
    let updated = 0;
    for (const task of tasks) {
      try {
        let overrides = {};
        try {
          overrides = JSON.parse(task.overrides_json || '{}');
        } catch (e) {
          overrides = {};
        }

        // overridesのstepsを新しいものに更新
        overrides.steps = presetFromFile.steps;

        // タスクを更新
        run(
          'UPDATE tasks SET overrides_json = ?, updated_at = ? WHERE id = ?',
          [JSON.stringify(overrides), Date.now(), task.id]
        );

        console.log(`✅ 更新完了: ${task.runId || `ID:${task.id}`} (ステータス: ${task.status})`);
        updated++;
      } catch (error) {
        console.error(`❌ 更新失敗: ${task.runId || `ID:${task.id}`}`, error);
      }
    }

    console.log(`───────────────────────────────────────`);
    console.log(`\n✨ 更新結果:`);
    console.log(`  成功: ${updated}件`);
    console.log(`  失敗: ${tasks.length - updated}件`);

  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
    process.exit(1);
  }
}

updateQueue2Tasks();

