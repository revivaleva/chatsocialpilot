/**
 * 停止したタスクのresult_jsonをダンプして構造を確認するスクリプト
 */

import { initDb, query as dbQuery } from '../src/drivers/db.js';
import * as PresetService from '../src/services/presets.js';
import fs from 'node:fs';

// データベース初期化
initDb({ wal: true });

// タスク1～3のキュー名
const QUEUE_NAMES = ['default', 'queue2', 'queue3'];

async function main() {
  console.log('=== 停止したタスクのresult_jsonダンプ ===\n');

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

  // 2. 停止したタスクのresult_jsonをダンプ
  for (const queueName of QUEUE_NAMES) {
    const stoppedTasks = dbQuery<any>(
      `SELECT t.runId, t.container_id, tr.result_json
       FROM tasks t
       LEFT JOIN task_runs tr ON t.runId = tr.runId
       WHERE t.queue_name = ? AND t.preset_id = ? 
         AND (t.status = 'stopped' OR tr.status = 'stopped')
       ORDER BY tr.ended_at DESC
       LIMIT 5`,
      [queueName, followerPresetId]
    );
    
    if (stoppedTasks.length === 0) continue;
    
    console.log(`【${queueName}】停止したタスクのresult_json（最初の3件）:\n`);
    
    for (let i = 0; i < Math.min(stoppedTasks.length, 3); i++) {
      const task = stoppedTasks[i];
      console.log(`--- runId: ${task.runId} ---`);
      console.log(`コンテナ: ${task.container_id}`);
      
      if (task.result_json) {
        try {
          const result = JSON.parse(task.result_json);
          console.log('result_json構造:');
          console.log(JSON.stringify(result, null, 2));
          console.log('');
        } catch (e) {
          console.log('JSON解析エラー:', e);
          console.log('生のJSON:');
          console.log(task.result_json.substring(0, 500));
          console.log('');
        }
      } else {
        console.log('result_jsonなし');
        console.log('');
      }
    }
  }

  console.log('=== ダンプ完了 ===');
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});





