/**
 * 成功しているタスクを探すスクリプト
 */

import { initDb, query } from '../src/drivers/db';

interface Task {
  id: number;
  runId: string;
  preset_id: number;
  container_id: string;
  status: string;
  created_at: number;
}

interface Preset {
  id: number;
  name: string;
}

interface TaskRun {
  runId: string;
  status: string;
  result_json: string | null;
}

function main() {
  initDb({ wal: true });

  console.log('🔍 プリセット一覧を確認中...\n');

  // 全プリセットを取得
  const presets = query<Preset>(
    'SELECT id, name FROM presets ORDER BY id',
    []
  );

  console.log('📋 プリセット一覧:');
  for (const preset of presets) {
    console.log(`  ID: ${preset.id}, Name: ${preset.name}`);
  }

  // 各プリセットのタスク状況を確認
  console.log('\n' + '='.repeat(80));
  console.log('📊 各プリセットのタスク状況');
  console.log('='.repeat(80));

  for (const preset of presets) {
    const tasks = query<Task>(
      'SELECT id, runId, container_id, status, created_at FROM tasks WHERE preset_id = ? ORDER BY created_at DESC LIMIT 5',
      [preset.id]
    );

    if (tasks.length > 0) {
      const statusCounts: Record<string, number> = {};
      for (const task of tasks) {
        statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
      }

      console.log(`\nPreset ${preset.id} (${preset.name}):`);
      console.log(`  タスク数: ${tasks.length}件`);
      console.log(`  ステータス分布: ${JSON.stringify(statusCounts)}`);

      // 成功または実行中のタスクを表示
      const successfulTasks = tasks.filter(t => t.status === 'completed' || t.status === 'running');
      if (successfulTasks.length > 0) {
        console.log(`  成功/実行中タスク: ${successfulTasks.length}件`);
        for (const task of successfulTasks.slice(0, 3)) {
          console.log(`    - ${task.runId} (${task.status})`);
        }
      }
    }
  }

  // 成功したタスクの詳細を取得（プロフィール変更以外）
  console.log('\n' + '='.repeat(80));
  console.log('📋 成功したタスクの詳細（プロフィール変更以外）');
  console.log('='.repeat(80));

  const successfulTasks = query<Task>(
    "SELECT id, runId, preset_id, container_id, status, created_at FROM tasks WHERE preset_id != 18 AND status = 'done' ORDER BY created_at DESC LIMIT 10",
    []
  );

  console.log(`\n成功/実行中タスク数: ${successfulTasks.length}件\n`);

  for (let i = 0; i < successfulTasks.length; i++) {
    const task = successfulTasks[i];
    const preset = presets.find(p => p.id === task.preset_id);
    
    console.log(`[${i + 1}] Run ID: ${task.runId}`);
    console.log(`    Preset: ${preset?.name || `ID ${task.preset_id}`}`);
    console.log(`    Container ID: ${task.container_id}`);
    console.log(`    Status: ${task.status}`);
    
    // コンテナIDの形式を確認
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.container_id);
    console.log(`    UUID形式か: ${isUuid}`);

    // タスク実行履歴を確認
    const taskRun = query<TaskRun>(
      'SELECT runId, status, result_json FROM task_runs WHERE runId = ? ORDER BY started_at DESC LIMIT 1',
      [task.runId]
    )[0];

    if (taskRun) {
      console.log(`    Task Run Status: ${taskRun.status}`);
      if (taskRun.result_json) {
        try {
          const result = JSON.parse(taskRun.result_json);
          if (result.error) {
            console.log(`    Error: ${result.error}`);
          } else {
            console.log(`    Result: OK`);
          }
        } catch (e) {
          // JSON解析エラーは無視
        }
      }
    }
    console.log('');
  }
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}

