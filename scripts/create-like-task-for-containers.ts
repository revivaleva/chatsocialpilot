#!/usr/bin/env tsx
/**
 * 指定されたコンテナIDリストに対してタスクを作成
 * 
 * 使用方法:
 *   tsx scripts/create-like-task-for-containers.ts <preset_id> <container_id1> <container_id2> ...
 * 
 * 例:
 *   tsx scripts/create-like-task-for-containers.ts 2 615b8ead-6c7b-4d3c-baef-58e976bf8d7d 198b0219-2918-4da8-9da8-35c3564f09a6
 */

import { initDb, query } from '../src/drivers/db.js';
import { enqueueTask } from '../src/services/taskQueue.js';

async function main() {
  initDb({ wal: true });
  
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('使用方法: tsx scripts/create-like-task-for-containers.ts <preset_id> <container_id1> <container_id2> ...');
    console.error('例: tsx scripts/create-like-task-for-containers.ts 2 615b8ead-6c7b-4d3c-baef-58e976bf8d7d 198b0219-2918-4da8-9da8-35c3564f09a6');
    process.exit(1);
  }
  
  const presetId = parseInt(args[0], 10);
  if (isNaN(presetId)) {
    console.error(`エラー: preset_idが数値ではありません: ${args[0]}`);
    process.exit(1);
  }
  
  const containerIds = args.slice(1);
  
  // presetの存在確認
  const preset = query<{ id: number; name: string }>(
    'SELECT id, name FROM presets WHERE id = ?',
    [presetId]
  )[0];
  
  if (!preset) {
    console.error(`エラー: preset ID ${presetId} が見つかりませんでした。`);
    process.exit(1);
  }
  
  console.log(`Preset: [${preset.id}] ${preset.name}`);
  console.log(`対象コンテナ数: ${containerIds.length}件\n`);
  
  // グループIDを取得（最初のコンテナから取得を試みる）
  let groupId: string | null = null;
  if (containerIds.length > 0) {
    const firstContainer = query<{ group_id: string | null }>(
      `SELECT cgm.group_id 
       FROM container_group_members cgm
       WHERE cgm.container_id = ?`,
      [containerIds[0]]
    )[0];
    
    if (firstContainer) {
      groupId = firstContainer.group_id;
      if (groupId) {
        const group = query<{ name: string }>(
          'SELECT name FROM container_groups WHERE id = ?',
          [groupId]
        )[0];
        if (group) {
          console.log(`グループ: ${group.name} (ID: ${groupId})\n`);
        }
      }
    }
  }
  
  // 各コンテナにタスクを作成
  const results: Array<{ containerId: string; runId: string | null; error: string | null }> = [];
  
  for (const containerId of containerIds) {
    try {
      // コンテナの存在確認（オプション）
      const containerCheck = query<{ container_id: string }>(
        `SELECT container_id FROM container_group_members WHERE container_id = ?`,
        [containerId]
      );
      
      if (containerCheck.length === 0) {
        console.log(`⚠️  コンテナ ${containerId}: グループメンバーとして見つかりません（タスクは作成します）`);
      }
      
      const runId = enqueueTask({
        presetId,
        containerId,
        groupId: groupId || undefined
      });
      
      results.push({ containerId, runId, error: null });
      console.log(`✅ コンテナ ${containerId}: タスク作成成功 (Run ID: ${runId})`);
    } catch (e: any) {
      const errorMsg = String(e?.message || e);
      results.push({ containerId, runId: null, error: errorMsg });
      console.error(`❌ コンテナ ${containerId}: タスク作成失敗 - ${errorMsg}`);
    }
  }
  
  // 結果サマリ
  console.log('\n=== 結果サマリ ===');
  const successCount = results.filter(r => r.runId !== null).length;
  const failCount = results.filter(r => r.runId === null).length;
  
  console.log(`成功: ${successCount}件`);
  console.log(`失敗: ${failCount}件`);
  
  if (failCount > 0) {
    console.log('\n失敗したコンテナ:');
    for (const result of results) {
      if (result.runId === null) {
        console.log(`  - ${result.containerId}: ${result.error}`);
      }
    }
  }
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

