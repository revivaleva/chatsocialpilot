/**
 * プリセットの違いを詳しく比較するスクリプト
 */

import { initDb, query } from '../src/drivers/db';

interface Preset {
  id: number;
  name: string;
  steps_json: string;
}

function main() {
  initDb({ wal: true });

  console.log('🔍 プリセットの違いを比較中...\n');

  // プロフィール変更プリセット（失敗）
  const profilePreset = query<Preset>(
    'SELECT id, name, steps_json FROM presets WHERE id = 18',
    []
  )[0];

  // いいね3点セットプリセット（成功）
  const likePreset = query<Preset>(
    'SELECT id, name, steps_json FROM presets WHERE id = 24',
    []
  )[0];

  if (!profilePreset || !likePreset) {
    console.log('❌ プリセットが見つかりませんでした');
    return;
  }

  console.log('='.repeat(80));
  console.log('📋 プロフィール変更プリセット（Preset 18）');
  console.log('='.repeat(80));
  console.log(`Name: ${profilePreset.name}\n`);

  try {
    const steps = JSON.parse(profilePreset.steps_json || '[]');
    console.log(`Steps数: ${steps.length}\n`);
    console.log('ステップ一覧:');
    steps.forEach((step: any, index: number) => {
      console.log(`  [${index + 1}] ${step.type || 'unknown'}: ${step.name || step.description || 'N/A'}`);
    });

    const hasCreateContainer = steps.some((step: any) => step.type === 'createContainer');
    console.log(`\nコンテナ作成ステップがあるか: ${hasCreateContainer}`);
  } catch (e) {
    console.log(`⚠ Steps JSON解析エラー: ${e}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('📋 いいね3点セットプリセット（Preset 24）');
  console.log('='.repeat(80));
  console.log(`Name: ${likePreset.name}\n`);

  try {
    const steps = JSON.parse(likePreset.steps_json || '[]');
    console.log(`Steps数: ${steps.length}\n`);
    console.log('ステップ一覧:');
    steps.forEach((step: any, index: number) => {
      console.log(`  [${index + 1}] ${step.type || 'unknown'}: ${step.name || step.description || 'N/A'}`);
    });

    const hasCreateContainer = steps.some((step: any) => step.type === 'createContainer');
    console.log(`\nコンテナ作成ステップがあるか: ${hasCreateContainer}`);
  } catch (e) {
    console.log(`⚠ Steps JSON解析エラー: ${e}`);
  }

  // タスクのcontainer_idの違いを確認
  console.log('\n' + '='.repeat(80));
  console.log('📊 タスクのcontainer_idの違い');
  console.log('='.repeat(80));

  const profileTasks = query<{ container_id: string }>(
    'SELECT container_id FROM tasks WHERE preset_id = 18 LIMIT 5',
    []
  );

  const likeTasks = query<{ container_id: string }>(
    'SELECT container_id FROM tasks WHERE preset_id = 24 LIMIT 5',
    []
  );

  console.log('\nプロフィール変更タスクのContainer ID:');
  for (const task of profileTasks) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.container_id);
    console.log(`  ${task.container_id} (UUID形式: ${isUuid})`);
  }

  console.log('\nいいね3点セットタスクのContainer ID:');
  for (const task of likeTasks) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.container_id);
    console.log(`  ${task.container_id} (UUID形式: ${isUuid})`);
  }
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}

