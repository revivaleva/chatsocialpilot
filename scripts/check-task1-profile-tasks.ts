/**
 * タスク1のプロフィール変更タスクのoverrides_jsonを確認するスクリプト
 */

import { initDb, query } from '../src/drivers/db';

interface Task {
  id: number;
  runId: string;
  container_id: string;
  overrides_json: string;
  queue_name: string;
  status: string;
}

function main() {
  initDb({ wal: true });

  console.log('🔍 タスク1のプロフィール変更タスクを確認中...\n');

  // タスク1（queue_name = 'default' または 'タスク1'）のプロフィール変更タスク（preset_id = 18）を取得
  const tasks = query<Task>(
    "SELECT id, runId, container_id, overrides_json, queue_name, status FROM tasks WHERE preset_id = 18 AND (queue_name = 'default' OR queue_name = 'タスク1') ORDER BY created_at DESC LIMIT 20",
    []
  );

  console.log(`📊 タスク1のプロフィール変更タスク数: ${tasks.length}件\n`);

  if (tasks.length === 0) {
    console.log('❌ タスク1にプロフィール変更タスクが見つかりませんでした');
    return;
  }

  console.log('📋 タスクの詳細（最初の20件）:\n');
  console.log('='.repeat(80));

  let nameEmptyCount = 0;
  let bioEmptyCount = 0;
  let nameSetCount = 0;
  let bioSetCount = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    try {
      const overrides = JSON.parse(task.overrides_json || '{}');
      
      console.log(`\n[${i + 1}] Run ID: ${task.runId}`);
      console.log(`    Container ID: ${task.container_id}`);
      console.log(`    Status: ${task.status}`);
      console.log(`    Queue: ${task.queue_name}`);
      console.log(`    name: "${overrides.name || ''}" (length: ${overrides.name?.length || 0})`);
      console.log(`    bio: "${overrides.bio || ''}" (length: ${overrides.bio?.length || 0})`);
      console.log(`    location: "${overrides.location || ''}"`);
      console.log(`    website: "${overrides.website || ''}"`);
      console.log(`    banner_image_path: ${overrides.banner_image_path ? '設定済み' : '未設定'}`);
      console.log(`    avatar_image_path: ${overrides.avatar_image_path ? '設定済み' : '未設定'}`);

      // 統計
      if (overrides.name && overrides.name.trim() !== '') {
        nameSetCount++;
      } else {
        nameEmptyCount++;
      }
      if (overrides.bio && overrides.bio.trim() !== '') {
        bioSetCount++;
      } else {
        bioEmptyCount++;
      }
    } catch (e) {
      console.error(`  ✗ JSON解析エラー: ${task.runId} - ${e}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 統計情報');
  console.log('='.repeat(80));
  console.log(`総タスク数: ${tasks.length}件`);
  console.log(`nameが設定されている件数: ${nameSetCount}件`);
  console.log(`nameが空/未設定の件数: ${nameEmptyCount}件`);
  console.log(`bioが設定されている件数: ${bioSetCount}件`);
  console.log(`bioが空/未設定の件数: ${bioEmptyCount}件`);
  console.log('='.repeat(80));

  // 全タスク1のプロフィール変更タスク数を確認
  const totalCount = query<{ count: number }>(
    "SELECT COUNT(*) as count FROM tasks WHERE preset_id = 18 AND (queue_name = 'default' OR queue_name = 'タスク1')"
  );
  console.log(`\nタスク1のプロフィール変更タスクの総数: ${totalCount[0]?.count || 0}件`);
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}

