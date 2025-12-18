/**
 * 失敗したタスクを調査するスクリプト
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
  updated_at: number;
  queue_name: string;
}

interface TaskRun {
  id: number;
  runId: string;
  task_id: number;
  started_at: number;
  ended_at: number | null;
  status: string;
  result_json: string | null;
}

function main() {
  initDb({ wal: true });

  const targetRunId = 'run-18-2025-12-10T05-13-48-385Z-365251';

  console.log(`🔍 タスク ${targetRunId} を調査中...\n`);

  // タスク情報を取得
  const tasks = query<Task>(
    'SELECT id, runId, preset_id, container_id, overrides_json, status, created_at, updated_at, queue_name FROM tasks WHERE runId = ?',
    [targetRunId]
  );

  if (tasks.length === 0) {
    console.log('❌ タスクが見つかりませんでした');
    return;
  }

  const task = tasks[0];
  console.log('='.repeat(80));
  console.log('📋 タスク情報');
  console.log('='.repeat(80));
  console.log(`ID: ${task.id}`);
  console.log(`Run ID: ${task.runId}`);
  console.log(`Preset ID: ${task.preset_id}`);
  console.log(`Container ID: ${task.container_id}`);
  console.log(`Status: ${task.status}`);
  console.log(`Queue: ${task.queue_name}`);
  console.log(`Created At: ${new Date(task.created_at).toISOString()}`);
  console.log(`Updated At: ${new Date(task.updated_at).toISOString()}`);

  try {
    const overrides = JSON.parse(task.overrides_json || '{}');
    console.log('\n📝 Overrides:');
    console.log(JSON.stringify(overrides, null, 2));
  } catch (e) {
    console.log(`\n⚠ Overrides JSON解析エラー: ${e}`);
    console.log(`Raw: ${task.overrides_json}`);
  }

  // タスク実行情報を取得
  const taskRuns = query<TaskRun>(
    'SELECT id, runId, task_id, started_at, ended_at, status, result_json FROM task_runs WHERE runId = ? ORDER BY started_at DESC',
    [targetRunId]
  );

  console.log('\n' + '='.repeat(80));
  console.log('📊 タスク実行履歴');
  console.log('='.repeat(80));
  console.log(`実行回数: ${taskRuns.length}回\n`);

  for (let i = 0; i < taskRuns.length; i++) {
    const run = taskRuns[i];
    console.log(`[実行 ${i + 1}]`);
    console.log(`  ID: ${run.id}`);
    console.log(`  Task ID: ${run.task_id}`);
    console.log(`  Status: ${run.status}`);
    console.log(`  Started At: ${run.started_at ? new Date(run.started_at).toISOString() : 'null'}`);
    console.log(`  Ended At: ${run.ended_at ? new Date(run.ended_at).toISOString() : 'null'}`);
    
    if (run.result_json) {
      try {
        const result = JSON.parse(run.result_json);
        console.log(`  Result:`);
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        console.log(`  Result (raw): ${run.result_json}`);
      }
    } else {
      console.log(`  Result: null`);
    }
    console.log('');
  }

  // プリセット情報を取得
  const presets = query<{ id: number; name: string; steps_json: string }>(
    'SELECT id, name, steps_json FROM presets WHERE id = ?',
    [task.preset_id]
  );

  if (presets.length > 0) {
    const preset = presets[0];
    console.log('='.repeat(80));
    console.log('📋 プリセット情報');
    console.log('='.repeat(80));
    console.log(`ID: ${preset.id}`);
    console.log(`Name: ${preset.name}`);
    
    try {
      const steps = JSON.parse(preset.steps_json || '[]');
      console.log(`Steps数: ${steps.length}`);
      console.log('\nステップ一覧:');
      steps.forEach((step: any, index: number) => {
        console.log(`  [${index + 1}] ${step.type || 'unknown'}: ${JSON.stringify(step).substring(0, 100)}...`);
      });
    } catch (e) {
      console.log(`⚠ Steps JSON解析エラー: ${e}`);
    }
  }

  // コンテナ情報を確認
  console.log('\n' + '='.repeat(80));
  console.log('🔍 コンテナ情報');
  console.log('='.repeat(80));
  console.log(`Container ID: ${task.container_id}`);

  // x_accountsテーブルから情報を取得
  const xAccounts = query<{ container_id: string; email: string; x_username: string | null; auth_token: string | null; ct0: string | null }>(
    'SELECT container_id, email, x_username, auth_token, ct0 FROM x_accounts WHERE container_id = ?',
    [task.container_id]
  );

  if (xAccounts.length > 0) {
    const account = xAccounts[0];
    console.log(`Email: ${account.email || 'null'}`);
    console.log(`X Username: ${account.x_username || 'null'}`);
    console.log(`Auth Token: ${account.auth_token ? '設定済み' : '未設定'}`);
    console.log(`CT0: ${account.ct0 ? '設定済み' : '未設定'}`);
  } else {
    console.log('⚠ x_accountsテーブルに該当するアカウントが見つかりませんでした');
  }

  // profile_dataテーブルから情報を取得
  const profileData = query<{ container_id: string; name: string; bio: string; banner_image_path: string; avatar_image_path: string }>(
    'SELECT container_id, name, bio, banner_image_path, avatar_image_path FROM profile_data WHERE container_id = ?',
    [task.container_id]
  );

  if (profileData.length > 0) {
    const profile = profileData[0];
    console.log('\n📝 プロフィール情報:');
    console.log(`Name: ${profile.name || 'null'}`);
    console.log(`Bio: ${profile.bio ? profile.bio.substring(0, 50) + '...' : 'null'}`);
    console.log(`Banner Image: ${profile.banner_image_path ? '設定済み' : '未設定'}`);
    console.log(`Avatar Image: ${profile.avatar_image_path ? '設定済み' : '未設定'}`);
  } else {
    console.log('\n⚠ profile_dataテーブルに該当するプロフィール情報が見つかりませんでした');
  }
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}

