/**
 * タスク1の既存プロフィール変更タスクを削除するスクリプト
 */

import { initDb, query, run } from '../src/drivers/db';

interface Task {
  id: number;
  runId: string;
  container_id: string;
  status: string;
}

function main() {
  initDb({ wal: true });

  console.log('🔍 タスク1の既存プロフィール変更タスクを確認中...\n');

  // タスク1（queue_name = 'default' または 'タスク1'）のプロフィール変更タスクを取得
  const tasks = query<Task>(
    "SELECT id, runId, container_id, status FROM tasks WHERE preset_id = 18 AND (queue_name = 'default' OR queue_name = 'タスク1')",
    []
  );

  console.log(`📊 削除対象タスク数: ${tasks.length}件\n`);

  if (tasks.length === 0) {
    console.log('❌ 削除対象のタスクが見つかりませんでした');
    return;
  }

  console.log('🗑️  タスクを削除中...\n');

  let deletedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    try {
      // task_runsテーブルから関連レコードを削除
      run('DELETE FROM task_runs WHERE runId = ?', [task.runId]);
      // tasksテーブルからレコードを削除
      run('DELETE FROM tasks WHERE id = ?', [task.id]);
      deletedCount++;
      
      if ((i + 1) % 50 === 0 || (i + 1) === tasks.length) {
        console.log(`  [${i + 1}/${tasks.length}] 削除中...`);
      }
    } catch (e: any) {
      errorCount++;
      console.error(`  ✗ 削除エラー: ${task.runId} - ${e?.message || String(e)}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 処理結果サマリ');
  console.log('='.repeat(60));
  console.log(`削除対象タスク数: ${tasks.length}件`);
  console.log(`✓ 削除成功: ${deletedCount}件`);
  console.log(`✗ 削除エラー: ${errorCount}件`);
  console.log('='.repeat(60));

  if (errorCount > 0) {
    process.exit(1);
  }
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}

