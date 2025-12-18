/**
 * 停止したタスクの詳細な原因を調査するスクリプト（result_jsonの内容を詳しく確認）
 */

import { initDb, query as dbQuery } from '../src/drivers/db.js';
import * as PresetService from '../src/services/presets.js';

// データベース初期化
initDb({ wal: true });

// タスク1～3のキュー名
const QUEUE_NAMES = ['default', 'queue2', 'queue3'];

async function main() {
  console.log('=== 停止したタスクの詳細分析 ===\n');

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

  // 2. 停止したタスクの詳細なresult_jsonを確認
  console.log('停止したタスクの詳細な結果を確認中...\n');
  
  for (const queueName of QUEUE_NAMES) {
    const stoppedTasks = dbQuery<any>(
      `SELECT t.id, t.runId, t.container_id, t.status as task_status, 
              tr.result_json, tr.status as run_status, tr.started_at, tr.ended_at
       FROM tasks t
       LEFT JOIN task_runs tr ON t.runId = tr.runId
       WHERE t.queue_name = ? AND t.preset_id = ? 
         AND (t.status = 'stopped' OR tr.status = 'stopped')
       ORDER BY tr.ended_at DESC
       LIMIT 20`,
      [queueName, followerPresetId]
    );
    
    if (stoppedTasks.length === 0) continue;
    
    console.log(`【${queueName}】停止したタスク: ${stoppedTasks.length}件（最新20件を詳しく確認）\n`);
    
    const reasons: Record<string, number> = {
      'suspended': 0,
      'login': 0,
      'lock': 0,
      'ban': 0,
      'timeout': 0,
      'network': 0,
      'unknown': 0,
    };
    
    for (const task of stoppedTasks) {
      let reason = 'unknown';
      let details: any = {};
      
      if (task.result_json) {
        try {
          const result = JSON.parse(task.result_json);
          details = result;
          
          // ステップごとの結果を確認
          if (result.steps && Array.isArray(result.steps)) {
            for (const step of result.steps) {
              if (step.result) {
                const stepResult = typeof step.result === 'string' ? JSON.parse(step.result) : step.result;
                
                // 凍結検出
                if (stepResult.suspended === true || 
                    stepResult.error?.includes('凍結') ||
                    stepResult.error?.includes('ログインページが表示されています')) {
                  reason = 'suspended';
                  reasons.suspended++;
                  break;
                }
                
                // ログイン画面検出
                if (stepResult.error?.includes('ログイン') ||
                    stepResult.error?.includes('いま起きていることを見つけよう') ||
                    stepResult.loginPage === true) {
                  reason = 'login';
                  reasons.login++;
                  break;
                }
                
                // ロック検出
                if (stepResult.error?.includes('ロック') ||
                    stepResult.error?.includes('lock') ||
                    stepResult.error?.includes('restricted')) {
                  reason = 'lock';
                  reasons.lock++;
                  break;
                }
                
                // Ban検出
                if (stepResult.error?.includes('ban') ||
                    stepResult.error?.includes('permanently suspended')) {
                  reason = 'ban';
                  reasons.ban++;
                  break;
                }
              }
              
              // エラーメッセージから判定
              if (step.error) {
                const errorMsg = String(step.error).toLowerCase();
                if (errorMsg.includes('timeout')) {
                  reason = 'timeout';
                  reasons.timeout++;
                  break;
                }
                if (errorMsg.includes('network') || errorMsg.includes('err_aborted')) {
                  reason = 'network';
                  reasons.network++;
                  break;
                }
              }
            }
          }
          
          // 全体のエラーメッセージから判定
          if (reason === 'unknown' && result.error) {
            const errorMsg = String(result.error).toLowerCase();
            if (errorMsg.includes('suspended') || errorMsg.includes('凍結')) {
              reason = 'suspended';
              reasons.suspended++;
            } else if (errorMsg.includes('login') || errorMsg.includes('ログイン')) {
              reason = 'login';
              reasons.login++;
            } else if (errorMsg.includes('lock') || errorMsg.includes('ロック')) {
              reason = 'lock';
              reasons.lock++;
            } else if (errorMsg.includes('ban')) {
              reason = 'ban';
              reasons.ban++;
            } else if (errorMsg.includes('timeout')) {
              reason = 'timeout';
              reasons.timeout++;
            } else if (errorMsg.includes('network') || errorMsg.includes('err_aborted')) {
              reason = 'network';
              reasons.network++;
            } else {
              reasons.unknown++;
            }
          } else if (reason === 'unknown') {
            reasons.unknown++;
          }
          
          // 最初の5件だけ詳細を表示
          if (stoppedTasks.indexOf(task) < 5) {
            console.log(`  runId: ${task.runId}`);
            console.log(`  コンテナ: ${task.container_id}`);
            console.log(`  タスク状態: ${task.task_status}, 実行状態: ${task.run_status}`);
            console.log(`  判定された原因: ${reason}`);
            console.log(`  結果JSON（要約）:`);
            console.log(`    - error: ${result.error || 'なし'}`);
            console.log(`    - stepIndex: ${result.currentStepIndex !== undefined ? result.currentStepIndex : 'なし'}`);
            console.log(`    - stepsTotal: ${result.stepsTotal !== undefined ? result.stepsTotal : 'なし'}`);
            if (result.steps && Array.isArray(result.steps)) {
              console.log(`    - ステップ数: ${result.steps.length}`);
              for (let i = 0; i < Math.min(result.steps.length, 3); i++) {
                const step = result.steps[i];
                console.log(`      [ステップ${i}] type: ${step.type || '不明'}, error: ${step.error || 'なし'}`);
                if (step.result) {
                  try {
                    const stepResult = typeof step.result === 'string' ? JSON.parse(step.result) : step.result;
                    if (stepResult.suspended !== undefined) {
                      console.log(`        suspended: ${stepResult.suspended}`);
                    }
                    if (stepResult.error) {
                      console.log(`        error: ${stepResult.error}`);
                    }
                    if (stepResult.ok !== undefined) {
                      console.log(`        ok: ${stepResult.ok}`);
                    }
                  } catch (e) {
                    // 無視
                  }
                }
              }
            }
            console.log('');
          }
          
        } catch (e: any) {
          console.log(`  runId: ${task.runId} - JSON解析エラー: ${e?.message || String(e)}`);
          reasons.unknown++;
        }
      } else {
        if (stoppedTasks.indexOf(task) < 5) {
          console.log(`  runId: ${task.runId} - 結果JSONなし`);
        }
        reasons.unknown++;
      }
    }
    
    // 統計を表示
    console.log(`【${queueName}】原因別集計:`);
    console.log(`  アカウント凍結: ${reasons.suspended}件`);
    console.log(`  ログイン画面表示: ${reasons.login}件`);
    console.log(`  アカウントロック: ${reasons.lock}件`);
    console.log(`  アカウントBan: ${reasons.ban}件`);
    console.log(`  タイムアウト: ${reasons.timeout}件`);
    console.log(`  ネットワークエラー: ${reasons.network}件`);
    console.log(`  原因不明: ${reasons.unknown}件`);
    console.log('');
  }

  console.log('=== 調査完了 ===');
  console.log('\n※ より詳細な情報が必要な場合は、以下を確認してください:');
  console.log('  - logs/ ディレクトリ内のタスク実行ログ');
  console.log('  - スクリーンショット（shots/ ディレクトリ）');
  console.log('  - タスク実行時のブラウザの状態');
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});





