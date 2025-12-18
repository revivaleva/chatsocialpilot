/**
 * ロックアカウントを「ロックメール未変更」グループに移動するスクリプト
 */

import { initDb, query as dbQuery, run as dbRun } from '../src/drivers/db.js';
import * as PresetService from '../src/services/presets.js';

// データベース初期化
initDb({ wal: true });

// タスク1～3のキュー名
const QUEUE_NAMES = ['default', 'queue2', 'queue3'];

async function main() {
  console.log('=== ロックアカウントをグループに移動開始 ===\n');

  // 1. フォロワー数確認プリセットのIDを取得
  let followerPresetId: number | null = null;
  const allPresets = PresetService.listPresets();
  for (const preset of allPresets) {
    const presetObj = preset as any;
    const name = String(presetObj.name || '').toLowerCase();
    if (name.includes('フォロワー') || name.includes('follower')) {
      followerPresetId = presetObj.id;
      break;
    }
  }
  
  if (!followerPresetId) {
    console.error('フォロワー数確認プリセットが見つかりませんでした');
    process.exit(1);
  }

  // 2. 「ロックメール未変更」グループのIDを取得
  console.log('1. 「ロックメール未変更」グループを検索中...\n');
  
  const targetGroup = dbQuery<any>(
    `SELECT id, name FROM container_groups WHERE name LIKE '%ロックメール未変更%' LIMIT 1`
  );
  
  if (!targetGroup || targetGroup.length === 0) {
    console.error('   ✗ 「ロックメール未変更」グループが見つかりませんでした');
    console.log('   利用可能なグループ:');
    const allGroups = dbQuery<any>('SELECT id, name FROM container_groups ORDER BY name');
    for (const group of allGroups) {
      console.log(`     - ${group.name} (ID: ${group.id})`);
    }
    process.exit(1);
  }
  
  const groupId = targetGroup[0].id;
  const groupName = targetGroup[0].name;
  console.log(`   ✓ グループが見つかりました: "${groupName}" (ID: ${groupId})\n`);

  // 3. 停止したタスクからロックアカウントを特定
  console.log('2. 停止したタスクからロックアカウントを特定中...\n');
  
  const lockedContainerIds = new Set<string>();
  
  for (const queueName of QUEUE_NAMES) {
    const stoppedTasks = dbQuery<any>(
      `SELECT t.runId, t.container_id, tr.result_json
       FROM tasks t
       LEFT JOIN task_runs tr ON t.runId = tr.runId
       WHERE t.queue_name = ? AND t.preset_id = ? 
         AND (t.status = 'stopped' OR tr.status = 'stopped')`,
      [queueName, followerPresetId]
    );
    
    for (const task of stoppedTasks) {
      if (!task.container_id || !task.result_json) continue;
      
      try {
        const result = JSON.parse(task.result_json);
        
        // ステップの結果を確認
        if (result.steps && Array.isArray(result.steps)) {
          // evalステップ（index 1）の結果を確認
          const evalStep = result.steps.find((s: any) => s.index === 1);
          
          if (evalStep && evalStep.result && evalStep.result.body) {
            const stepBody = evalStep.result.body;
            const stepResult = stepBody.result;
            const url = stepBody.url;
            
            // ロックアカウントの判定
            if (url && url.includes('/account/access')) {
              lockedContainerIds.add(task.container_id);
              continue;
            }
            
            if (stepResult && (
              stepResult.locked === true ||
              stepResult.error?.includes('Cloudflareチャレンジ') ||
              stepResult.error?.includes('ロックされている可能性')
            )) {
              lockedContainerIds.add(task.container_id);
              continue;
            }
          }
        }
      } catch (e) {
        // JSON解析失敗は無視
      }
    }
  }
  
  console.log(`   ロックアカウント: ${lockedContainerIds.size}件`);
  console.log('');

  // 4. 現在のグループメンバーシップを確認
  console.log('3. 現在のグループメンバーシップを確認中...\n');
  
  const lockedList = Array.from(lockedContainerIds);
  const placeholders = lockedList.map(() => '?').join(',');
  
  const currentMemberships = dbQuery<any>(
    `SELECT container_id, group_id FROM container_group_members 
     WHERE container_id IN (${placeholders})`,
    lockedList
  );
  
  const containersInOtherGroups: Array<{ containerId: string; currentGroupId: string | null }> = [];
  const containersNotInAnyGroup: string[] = [];
  
  const membershipMap = new Map<string, string | null>();
  for (const membership of currentMemberships) {
    membershipMap.set(membership.container_id, membership.group_id);
  }
  
  for (const containerId of lockedList) {
    const currentGroupId = membershipMap.get(containerId) || null;
    if (currentGroupId) {
      if (currentGroupId !== groupId) {
        containersInOtherGroups.push({ containerId, currentGroupId });
      }
    } else {
      containersNotInAnyGroup.push(containerId);
    }
  }
  
  console.log(`   他のグループに所属しているコンテナ: ${containersInOtherGroups.length}件`);
  console.log(`   グループ未所属のコンテナ: ${containersNotInAnyGroup.length}件`);
  console.log(`   既に「ロックメール未変更」グループに所属: ${lockedList.length - containersInOtherGroups.length - containersNotInAnyGroup.length}件`);
  console.log('');

  // 5. 既存のグループメンバーシップを削除（他のグループに所属している場合）
  console.log('4. 既存のグループメンバーシップを削除中...\n');
  
  let removedCount = 0;
  for (const item of containersInOtherGroups) {
    try {
      dbRun('DELETE FROM container_group_members WHERE container_id = ?', [item.containerId]);
      removedCount++;
      if (removedCount % 10 === 0) {
        console.log(`   ${removedCount}件削除済み...`);
      }
    } catch (e: any) {
      console.error(`   ✗ エラー: コンテナ ${item.containerId} のグループ削除に失敗: ${e?.message || String(e)}`);
    }
  }
  
  if (removedCount > 0) {
    console.log(`   ✓ 合計 ${removedCount}件のグループメンバーシップを削除しました\n`);
  } else {
    console.log(`   ✓ 削除するグループメンバーシップはありませんでした\n`);
  }

  // 6. 「ロックメール未変更」グループに追加
  console.log('5. 「ロックメール未変更」グループに追加中...\n');
  
  let addedCount = 0;
  const now = Date.now();
  
  for (const containerId of lockedList) {
    try {
      // 既に該当グループに所属しているか確認
      const existing = dbQuery<any>(
        'SELECT container_id FROM container_group_members WHERE container_id = ? AND group_id = ?',
        [containerId, groupId]
      );
      
      if (!existing || existing.length === 0) {
        // 新規追加
        dbRun(
          'INSERT INTO container_group_members(container_id, group_id, created_at, updated_at) VALUES(?, ?, ?, ?)',
          [containerId, groupId, now, now]
        );
        addedCount++;
        if (addedCount % 10 === 0) {
          console.log(`   ${addedCount}件追加済み...`);
        }
      }
    } catch (e: any) {
      // UNIQUE制約違反の場合は既に存在するので無視
      if (e?.message?.includes('UNIQUE constraint')) {
        // 既に存在する場合は更新時刻だけ更新
        try {
          dbRun(
            'UPDATE container_group_members SET updated_at = ? WHERE container_id = ? AND group_id = ?',
            [now, containerId, groupId]
          );
        } catch (e2) {
          // 無視
        }
      } else {
        console.error(`   ✗ エラー: コンテナ ${containerId} のグループ追加に失敗: ${e?.message || String(e)}`);
      }
    }
  }
  
  console.log(`   ✓ 合計 ${addedCount}件のコンテナをグループに追加しました\n`);

  // 7. 結果サマリー
  console.log('=== 処理完了 ===');
  console.log(`対象ロックアカウント数: ${lockedContainerIds.size}件`);
  console.log(`削除したグループメンバーシップ: ${removedCount}件`);
  console.log(`追加したグループメンバーシップ: ${addedCount}件`);
  console.log(`対象グループ: "${groupName}" (ID: ${groupId})`);
  console.log('');
  
  // 8. 処理後の状態確認
  console.log('6. 処理後の状態確認...\n');
  
  const finalMemberships = dbQuery<any>(
    `SELECT COUNT(*) as count FROM container_group_members WHERE group_id = ?`,
    [groupId]
  );
  
  console.log(`   「ロックメール未変更」グループのメンバー数: ${finalMemberships[0]?.count || 0}件`);
  console.log('');

  console.log('=== すべての処理が完了しました ===');
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});





