/**
 * 実行済みのログインタスクを削除するスクリプト
 * 
 * 処理内容:
 * 1. プリセット17（X Authログイン）のタスクを取得
 * 2. task_runsテーブルで実行済み（ended_atがNULLでない）のタスクを特定
 * 3. 実行済みのタスクを削除
 * 
 * 使用方法:
 *   npx tsx scripts/delete-completed-login-tasks.ts
 */

import { initDb, query, run } from '../src/drivers/db';

interface Task {
  id: number;
  runId: string;
  container_id: string | null;
  status: string;
  overrides_json: string;
}

interface TaskRun {
  runId: string;
  ended_at: number | null;
  status: string | null;
}

/**
 * 実行済みのタスクを取得
 * task_runsテーブルでended_atがNULLでないタスクを実行済みとみなす
 */
function getCompletedTasks(): Task[] {
  const completedTasks = query<Task>(
    `SELECT DISTINCT t.id, t.runId, t.container_id, t.status, t.overrides_json
     FROM tasks t
     INNER JOIN task_runs tr ON t.runId = tr.runId
     WHERE t.preset_id = 17
       AND tr.ended_at IS NOT NULL
     ORDER BY t.created_at ASC`,
    []
  );
  return completedTasks || [];
}

/**
 * タスクを削除
 */
function deleteTask(taskId: number, runId: string): void {
  // tasksテーブルから削除
  run('DELETE FROM tasks WHERE id = ?', [taskId]);
  // task_runsテーブルからも削除（関連する実行ログがあれば）
  run('DELETE FROM task_runs WHERE runId = ?', [runId]);
}

/**
 * コンテナ名を取得
 */
function getContainerName(overridesJson: string): string {
  try {
    const overrides = JSON.parse(overridesJson || '{}');
    return String(overrides.container_name || '不明');
  } catch (e) {
    return '不明';
  }
}

function main() {
  // データベース初期化
  initDb({ wal: true });

  console.log('🔍 実行済みタスクを確認中...\n');

  // 実行済みのタスクを取得
  const completedTasks = getCompletedTasks();
  console.log(`実行済みタスク数: ${completedTasks.length}件\n`);

  if (completedTasks.length === 0) {
    console.log('✓ 実行済みのタスクはありません');
    return;
  }

  // 削除実行
  console.log('🗑️  実行済みタスクを削除中...\n');
  let deleted = 0;
  let errors = 0;

  for (const task of completedTasks) {
    try {
      const containerName = getContainerName(task.overrides_json);
      
      deleteTask(task.id, task.runId);
      deleted++;
      console.log(`  ✓ 削除: ${containerName} (Run ID: ${task.runId})`);
    } catch (e: any) {
      errors++;
      console.error(`  ✗ 削除エラー (Run ID: ${task.runId}): ${e?.message || String(e)}`);
    }
  }

  // 結果サマリ
  console.log('\n' + '='.repeat(60));
  console.log('📊 処理結果サマリ');
  console.log('='.repeat(60));
  console.log(`実行済みタスク数: ${completedTasks.length}件`);
  console.log(`✓ 削除成功: ${deleted}件`);
  console.log(`✗ 削除エラー: ${errors}件`);
  console.log('='.repeat(60));

  if (errors > 0) {
    process.exit(1);
  }
}

main();


