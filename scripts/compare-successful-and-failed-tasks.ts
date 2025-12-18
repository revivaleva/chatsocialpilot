/**
 * 成功したタスクと失敗したタスクを比較するスクリプト
 */

import { initDb, query } from '../src/drivers/db';

interface Task {
  id: number;
  runId: string;
  preset_id: number;
  container_id: string;
  overrides_json: string;
  status: string;
  created_at: number;
}

interface TaskRun {
  id: number;
  runId: string;
  status: string;
  result_json: string | null;
  started_at: number;
  ended_at: number | null;
}

interface Preset {
  id: number;
  name: string;
  steps_json: string;
}

function main() {
  initDb({ wal: true });

  console.log('🔍 成功したタスクと失敗したタスクを比較中...\n');

  // 失敗したタスク（プロフィール変更）
  const failedTask = query<Task>(
    "SELECT id, runId, preset_id, container_id, overrides_json, status, created_at FROM tasks WHERE runId = 'run-18-2025-12-10T05-13-48-385Z-365251'",
    []
  )[0];

  if (!failedTask) {
    console.log('❌ 失敗したタスクが見つかりませんでした');
    return;
  }

  // 成功したタスク（いいね3点セットなど）を取得
  // 完了または実行中のタスクを取得（プロフィール変更以外）
  const successfulTasks = query<Task>(
    "SELECT id, runId, preset_id, container_id, overrides_json, status, created_at FROM tasks WHERE preset_id != 18 AND (status = 'completed' OR status = 'running') ORDER BY created_at DESC LIMIT 10",
    []
  );

  console.log('='.repeat(80));
  console.log('📋 失敗したタスク（プロフィール変更）');
  console.log('='.repeat(80));
  console.log(`Run ID: ${failedTask.runId}`);
  console.log(`Preset ID: ${failedTask.preset_id}`);
  console.log(`Container ID: ${failedTask.container_id}`);
  console.log(`Status: ${failedTask.status}`);
  console.log(`Created At: ${new Date(failedTask.created_at).toISOString()}`);

  // プリセット情報を取得
  const failedPreset = query<Preset>(
    'SELECT id, name, steps_json FROM presets WHERE id = ?',
    [failedTask.preset_id]
  )[0];

  if (failedPreset) {
    console.log(`Preset Name: ${failedPreset.name}`);
    try {
      const steps = JSON.parse(failedPreset.steps_json || '[]');
      console.log(`Steps数: ${steps.length}`);
      
      // コンテナ作成ステップがあるか確認
      const hasCreateContainerStep = steps.some((step: any) => step.type === 'createContainer');
      console.log(`コンテナ作成ステップがあるか: ${hasCreateContainerStep}`);
    } catch (e) {
      console.log(`⚠ Steps JSON解析エラー: ${e}`);
    }
  }

  // タスク実行履歴を取得
  const failedTaskRun = query<TaskRun>(
    'SELECT id, runId, status, result_json, started_at, ended_at FROM task_runs WHERE runId = ? ORDER BY started_at DESC LIMIT 1',
    [failedTask.runId]
  )[0];

  if (failedTaskRun && failedTaskRun.result_json) {
    try {
      const result = JSON.parse(failedTaskRun.result_json);
      console.log(`\nエラー詳細:`);
      console.log(`  ${result.error || 'N/A'}`);
    } catch (e) {
      console.log(`\nエラー詳細: ${failedTaskRun.result_json}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📋 成功したタスク（いいね3点セットなど）');
  console.log('='.repeat(80));

  for (let i = 0; i < successfulTasks.length; i++) {
    const task = successfulTasks[i];
    console.log(`\n[成功タスク ${i + 1}]`);
    console.log(`Run ID: ${task.runId}`);
    console.log(`Preset ID: ${task.preset_id}`);
    console.log(`Container ID: ${task.container_id}`);
    console.log(`Status: ${task.status}`);
    console.log(`Created At: ${new Date(task.created_at).toISOString()}`);

    // プリセット情報を取得
    const preset = query<Preset>(
      'SELECT id, name, steps_json FROM presets WHERE id = ?',
      [task.preset_id]
    )[0];

    if (preset) {
      console.log(`Preset Name: ${preset.name}`);
      try {
        const steps = JSON.parse(preset.steps_json || '[]');
        console.log(`Steps数: ${steps.length}`);
        
        // コンテナ作成ステップがあるか確認
        const hasCreateContainerStep = steps.some((step: any) => step.type === 'createContainer');
        console.log(`コンテナ作成ステップがあるか: ${hasCreateContainerStep}`);
      } catch (e) {
        console.log(`⚠ Steps JSON解析エラー: ${e}`);
      }
    }

    // タスク実行履歴を取得
    const taskRun = query<TaskRun>(
      'SELECT id, runId, status, result_json, started_at, ended_at FROM task_runs WHERE runId = ? ORDER BY started_at DESC LIMIT 1',
      [task.runId]
    )[0];

    if (taskRun) {
      console.log(`Task Run Status: ${taskRun.status}`);
      if (taskRun.started_at) {
        console.log(`Started At: ${new Date(taskRun.started_at).toISOString()}`);
      }
      if (taskRun.ended_at) {
        console.log(`Ended At: ${new Date(taskRun.ended_at).toISOString()}`);
        if (taskRun.started_at) {
          const duration = taskRun.ended_at - taskRun.started_at;
          console.log(`Duration: ${duration}ms (${Math.round(duration / 1000)}秒)`);
        }
      }
    }
  }

  // 比較分析
  console.log('\n' + '='.repeat(80));
  console.log('📊 比較分析');
  console.log('='.repeat(80));

  // コンテナIDの形式を比較
  const failedIsUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(failedTask.container_id);
  console.log(`\n失敗タスクのContainer ID形式:`);
  console.log(`  Container ID: ${failedTask.container_id}`);
  console.log(`  UUID形式か: ${failedIsUuid}`);

  console.log(`\n成功タスクのContainer ID形式:`);
  for (const task of successfulTasks) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.container_id);
    console.log(`  Container ID: ${task.container_id} (UUID形式: ${isUuid})`);
  }

  // プリセットの違いを確認
  console.log(`\nプリセットの違い:`);
  if (failedPreset) {
    try {
      const failedSteps = JSON.parse(failedPreset.steps_json || '[]');
      const failedHasCreateContainer = failedSteps.some((step: any) => step.type === 'createContainer');
      console.log(`  失敗タスク（Preset ${failedTask.preset_id}）:`);
      console.log(`    コンテナ作成ステップ: ${failedHasCreateContainer ? 'あり' : 'なし'}`);
      console.log(`    最初のステップ: ${failedSteps[0]?.type || 'N/A'}`);
    } catch (e) {
      console.log(`  ⚠ 解析エラー: ${e}`);
    }
  }

  for (const task of successfulTasks) {
    const preset = query<Preset>(
      'SELECT id, name, steps_json FROM presets WHERE id = ?',
      [task.preset_id]
    )[0];
    if (preset) {
      try {
        const steps = JSON.parse(preset.steps_json || '[]');
        const hasCreateContainer = steps.some((step: any) => step.type === 'createContainer');
        console.log(`  成功タスク（Preset ${task.preset_id}: ${preset.name}）:`);
        console.log(`    コンテナ作成ステップ: ${hasCreateContainer ? 'あり' : 'なし'}`);
        console.log(`    最初のステップ: ${steps[0]?.type || 'N/A'}`);
      } catch (e) {
        console.log(`  ⚠ 解析エラー: ${e}`);
      }
    }
  }
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}

