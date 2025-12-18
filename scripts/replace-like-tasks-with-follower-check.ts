/**
 * タスク1～3に登録されているいいねのプリセットのタスクをすべて削除し、
 * 代わりに12/6作成～12/9作成のグループのコンテナにフォロワー数確認のタスクを登録するスクリプト
 */

import { initDb, query as dbQuery, run as dbRun } from '../src/drivers/db.js';
import * as PresetService from '../src/services/presets.js';
import { enqueueTask } from '../src/services/taskQueue.js';
import fs from 'node:fs';
import path from 'node:path';

// データベース初期化
initDb({ wal: true });

// 12/6～12/9作成のグループを検索（2024年と2025年の両方を試す）
// 2024年12月6日 00:00:00 JST = 2024-12-05T15:00:00Z
// 2024年12月10日 00:00:00 JST = 2024-12-09T15:00:00Z
// 2025年12月6日 00:00:00 JST = 2025-12-05T15:00:00Z
// 2025年12月10日 00:00:00 JST = 2025-12-09T15:00:00Z
function getGroupDateRange(year: number) {
  const startDate = new Date(`${year}-12-06T00:00:00+09:00`);
  const endDate = new Date(`${year}-12-10T00:00:00+09:00`);
  return {
    start: startDate.getTime(),
    end: endDate.getTime(),
  };
}

// タスク1～3のキュー名
const QUEUE_NAMES = ['default', 'queue2', 'queue3'];

async function main() {
  console.log('=== タスク置き換えスクリプト開始 ===\n');

  // 1. いいねプリセットのIDを取得
  console.log('1. いいねプリセットを検索中...');
  const allPresets = PresetService.listPresets();
  const likePresetIds: number[] = [];
  
  for (const preset of allPresets) {
    const presetObj = preset as any;
    const name = String(presetObj.name || '').toLowerCase();
    const description = String(presetObj.description || '').toLowerCase();
    const stepsJson = String(presetObj.steps_json || '');
    
    // いいね関連のキーワードで判定
    if (
      name.includes('いいね') || name.includes('like') ||
      description.includes('いいね') || description.includes('like') ||
      stepsJson.includes('いいね') || stepsJson.includes('like') ||
      stepsJson.includes('Like')
    ) {
      likePresetIds.push(presetObj.id);
      console.log(`   見つかったいいねプリセット: ID=${presetObj.id}, 名前="${presetObj.name}"`);
    }
  }
  
  if (likePresetIds.length === 0) {
    console.log('   ⚠️ いいねプリセットが見つかりませんでした');
  } else {
    console.log(`   ✓ ${likePresetIds.length}個のいいねプリセットが見つかりました\n`);
  }

  // 2. タスク1～3のいいねプリセットタスクを削除
  console.log('2. タスク1～3のいいねプリセットタスクを削除中...');
  let deletedCount = 0;
  
  for (const queueName of QUEUE_NAMES) {
    if (likePresetIds.length > 0) {
      const placeholders = likePresetIds.map(() => '?').join(',');
      const sql = `DELETE FROM tasks WHERE queue_name = ? AND preset_id IN (${placeholders}) AND status != 'done'`;
      const result = dbRun(sql, [queueName, ...likePresetIds]);
      const count = (result as any).changes || 0;
      deletedCount += count;
      if (count > 0) {
        console.log(`   ${queueName}: ${count}件のタスクを削除`);
      }
    }
  }
  
  console.log(`   ✓ 合計 ${deletedCount}件のタスクを削除しました\n`);

  // 3. フォロワー数確認プリセットのIDを取得
  console.log('3. フォロワー数確認プリセットを検索中...');
  let followerPresetId: number | null = null;
  
  // まず、follower-count-only.jsonから読み込む
  const presetPath = path.resolve('presets', 'follower-count-only.json');
  if (fs.existsSync(presetPath)) {
    const presetContent = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
    const presetName = presetContent.name || 'フォロワー数取得・保存';
    
    // データベースから同名のプリセットを検索
    const existingPresets = dbQuery<any>(
      'SELECT id FROM presets WHERE name = ?',
      [presetName]
    );
    
    if (existingPresets && existingPresets.length > 0) {
      followerPresetId = existingPresets[0].id;
      console.log(`   ✓ フォロワー数確認プリセットが見つかりました: ID=${followerPresetId}, 名前="${presetName}"`);
    } else {
      // プリセットが存在しない場合は作成
      const stepsJson = JSON.stringify(presetContent.steps || []);
      const result = PresetService.createPreset(
        presetName,
        presetContent.description || '',
        stepsJson
      );
      followerPresetId = result.id;
      console.log(`   ✓ フォロワー数確認プリセットを作成しました: ID=${followerPresetId}`);
    }
  } else {
    // フォールバック: データベースから検索
    for (const preset of allPresets) {
      const presetObj = preset as any;
      const name = String(presetObj.name || '').toLowerCase();
      if (name.includes('フォロワー') || name.includes('follower')) {
        followerPresetId = presetObj.id;
        console.log(`   ✓ フォロワー数確認プリセットが見つかりました: ID=${followerPresetId}, 名前="${presetObj.name}"`);
        break;
      }
    }
  }
  
  if (!followerPresetId) {
    console.error('   ✗ フォロワー数確認プリセットが見つかりませんでした');
    process.exit(1);
  }
  console.log('');

  // 4. 12/6～12/9作成のグループを取得（2024年と2025年の両方を試す）
  console.log('4. 12/6～12/9作成のグループを検索中...');
  let groups: any[] = [];
  
  // まず2024年を試す
  const range2024 = getGroupDateRange(2024);
  groups = dbQuery<any>(
    `SELECT id, name, created_at FROM container_groups 
     WHERE created_at >= ? AND created_at < ?
     ORDER BY created_at ASC`,
    [range2024.start, range2024.end]
  );
  
  // 2024年で見つからなかった場合は2025年を試す
  if (groups.length === 0) {
    const range2025 = getGroupDateRange(2025);
    groups = dbQuery<any>(
      `SELECT id, name, created_at FROM container_groups 
       WHERE created_at >= ? AND created_at < ?
       ORDER BY created_at ASC`,
      [range2025.start, range2025.end]
    );
    if (groups.length > 0) {
      console.log(`   2025年の範囲で検索: ${new Date(range2025.start).toLocaleString('ja-JP')} ～ ${new Date(range2025.end).toLocaleString('ja-JP')}`);
    }
  } else {
    console.log(`   2024年の範囲で検索: ${new Date(range2024.start).toLocaleString('ja-JP')} ～ ${new Date(range2024.end).toLocaleString('ja-JP')}`);
  }
  
  if (groups.length === 0) {
    console.log('   ⚠️ 該当するグループが見つかりませんでした');
    console.log(`   2024年検索範囲: ${new Date(range2024.start).toLocaleString('ja-JP')} ～ ${new Date(range2024.end).toLocaleString('ja-JP')}`);
    const range2025 = getGroupDateRange(2025);
    console.log(`   2025年検索範囲: ${new Date(range2025.start).toLocaleString('ja-JP')} ～ ${new Date(range2025.end).toLocaleString('ja-JP')}`);
    process.exit(1);
  }
  
  console.log(`   ✓ ${groups.length}個のグループが見つかりました:`);
  for (const group of groups) {
    console.log(`     - ${group.name} (ID: ${group.id}, 作成日: ${new Date(group.created_at).toLocaleString('ja-JP')})`);
  }
  console.log('');

  // 5. 各グループのコンテナを取得
  console.log('5. 各グループのコンテナを取得中...');
  const groupIds = groups.map(g => g.id);
  const placeholders = groupIds.map(() => '?').join(',');
  const containers = dbQuery<any>(
    `SELECT container_id, group_id FROM container_group_members 
     WHERE group_id IN (${placeholders})`,
    groupIds
  );
  
  if (containers.length === 0) {
    console.log('   ⚠️ 該当するコンテナが見つかりませんでした');
    process.exit(1);
  }
  
  console.log(`   ✓ ${containers.length}個のコンテナが見つかりました\n`);

  // 6. 各コンテナにフォロワー数確認タスクを登録
  console.log('6. フォロワー数確認タスクを登録中...');
  let registeredCount = 0;
  
  for (const container of containers) {
    const containerId = container.container_id;
    const groupId = container.group_id;
    
    // タスク1～3の各キューに登録
    for (const queueName of QUEUE_NAMES) {
      try {
        const runId = enqueueTask({
          presetId: followerPresetId,
          containerId: containerId,
          overrides: {},
          scheduledAt: null, // 即座に実行可能
          groupId: groupId,
          waitMinutes: 10, // デフォルトの待機時間
        }, queueName);
        
        registeredCount++;
        if (registeredCount % 10 === 0) {
          console.log(`   ${registeredCount}件登録済み...`);
        }
      } catch (e: any) {
        console.error(`   ✗ エラー: コンテナ ${containerId} のタスク登録に失敗: ${e?.message || String(e)}`);
      }
    }
  }
  
  console.log(`   ✓ 合計 ${registeredCount}件のタスクを登録しました\n`);

  // 7. 結果サマリー
  console.log('=== 処理完了 ===');
  console.log(`削除したタスク: ${deletedCount}件`);
  console.log(`登録したタスク: ${registeredCount}件`);
  console.log(`対象グループ数: ${groups.length}個`);
  console.log(`対象コンテナ数: ${containers.length}個`);
  console.log(`使用したプリセットID: ${followerPresetId}`);
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});





