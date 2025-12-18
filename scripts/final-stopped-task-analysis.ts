/**
 * 停止したタスクの最終的な原因分析（Cloudflare/ロック/ログイン画面/Ban）
 */

import { initDb, query as dbQuery } from '../src/drivers/db.js';
import * as PresetService from '../src/services/presets.js';

// データベース初期化
initDb({ wal: true });

// タスク1～3のキュー名
const QUEUE_NAMES = ['default', 'queue2', 'queue3'];

async function main() {
  console.log('=== 停止したタスクの最終原因分析 ===\n');

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

  // 2. 停止したタスクのevalステップの結果を分析
  const allReasons: Record<string, number> = {
    'cloudflare_lock': 0,      // Cloudflareチャレンジ（ロック）
    'suspended': 0,            // アカウント凍結
    'login_required': 0,       // ログイン画面表示
    'account_access': 0,       // アカウントアクセス制限（/account/access）
    'follower_not_found': 0,   // フォロワー数取得失敗
    'other_error': 0,          // その他のエラー
    'unknown': 0,              // 原因不明
  };
  
  for (const queueName of QUEUE_NAMES) {
    const stoppedTasks = dbQuery<any>(
      `SELECT t.runId, t.container_id, tr.result_json
       FROM tasks t
       LEFT JOIN task_runs tr ON t.runId = tr.runId
       WHERE t.queue_name = ? AND t.preset_id = ? 
         AND (t.status = 'stopped' OR tr.status = 'stopped')`,
      [queueName, followerPresetId]
    );
    
    console.log(`【${queueName}】停止したタスク: ${stoppedTasks.length}件\n`);
    
    const queueReasons: Record<string, number> = {
      'cloudflare_lock': 0,
      'suspended': 0,
      'login_required': 0,
      'account_access': 0,
      'follower_not_found': 0,
      'other_error': 0,
      'unknown': 0,
    };
    
    for (const task of stoppedTasks) {
      if (!task.result_json) {
        queueReasons.unknown++;
        allReasons.unknown++;
        continue;
      }
      
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
            const title = stepBody.title;
            
            // URLで判定
            if (url && url.includes('/account/access')) {
              queueReasons.account_access++;
              allReasons.account_access++;
              continue;
            }
            
            // evalステップの結果で判定
            if (stepResult) {
              // Cloudflareチャレンジ（ロック）
              if (stepResult.locked === true ||
                  stepResult.error?.includes('Cloudflareチャレンジ') ||
                  stepResult.error?.includes('ロックされている可能性')) {
                queueReasons.cloudflare_lock++;
                allReasons.cloudflare_lock++;
                continue;
              }
              
              // アカウント凍結
              if (stepResult.suspended === true ||
                  stepResult.error?.includes('凍結されています')) {
                queueReasons.suspended++;
                allReasons.suspended++;
                continue;
              }
              
              // ログイン画面表示
              if (stepResult.login_required === true ||
                  stepResult.error?.includes('ログインページが表示されています')) {
                queueReasons.login_required++;
                allReasons.login_required++;
                continue;
              }
              
              // フォロワー数取得失敗
              if (stepResult.ok === false &&
                  stepResult.error?.includes('フォロワー数またはフォロー数が見つかりませんでした')) {
                queueReasons.follower_not_found++;
                allReasons.follower_not_found++;
                continue;
              }
              
              // その他のエラー
              if (stepResult.ok === false && stepResult.error) {
                queueReasons.other_error++;
                allReasons.other_error++;
                continue;
              }
            }
            
            // タイトルで判定
            if (title && title.includes('しばらくお待ちください')) {
              queueReasons.account_access++;
              allReasons.account_access++;
              continue;
            }
          }
        }
        
        queueReasons.unknown++;
        allReasons.unknown++;
      } catch (e) {
        queueReasons.unknown++;
        allReasons.unknown++;
      }
    }
    
    // 統計を表示
    console.log(`【${queueName}】原因別集計:`);
    console.log(`  Cloudflareチャレンジ（ロック）: ${queueReasons.cloudflare_lock}件`);
    console.log(`  アカウントアクセス制限: ${queueReasons.account_access}件`);
    console.log(`  アカウント凍結: ${queueReasons.suspended}件`);
    console.log(`  ログイン画面表示: ${queueReasons.login_required}件`);
    console.log(`  フォロワー数取得失敗: ${queueReasons.follower_not_found}件`);
    console.log(`  その他のエラー: ${queueReasons.other_error}件`);
    console.log(`  原因不明: ${queueReasons.unknown}件`);
    console.log('');
  }

  // 3. 全体統計
  const total = Object.values(allReasons).reduce((a, b) => a + b, 0);
  console.log('=== 全体統計 ===\n');
  console.log(`総停止数: ${total}件\n`);
  console.log('原因別内訳:');
  console.log(`  Cloudflareチャレンジ（ロック）: ${allReasons.cloudflare_lock}件 (${total > 0 ? ((allReasons.cloudflare_lock / total) * 100).toFixed(1) : 0}%)`);
  console.log(`  アカウントアクセス制限: ${allReasons.account_access}件 (${total > 0 ? ((allReasons.account_access / total) * 100).toFixed(1) : 0}%)`);
  console.log(`  アカウント凍結: ${allReasons.suspended}件 (${total > 0 ? ((allReasons.suspended / total) * 100).toFixed(1) : 0}%)`);
  console.log(`  ログイン画面表示: ${allReasons.login_required}件 (${total > 0 ? ((allReasons.login_required / total) * 100).toFixed(1) : 0}%)`);
  console.log(`  フォロワー数取得失敗: ${allReasons.follower_not_found}件 (${total > 0 ? ((allReasons.follower_not_found / total) * 100).toFixed(1) : 0}%)`);
  console.log(`  その他のエラー: ${allReasons.other_error}件 (${total > 0 ? ((allReasons.other_error / total) * 100).toFixed(1) : 0}%)`);
  console.log(`  原因不明: ${allReasons.unknown}件 (${total > 0 ? ((allReasons.unknown / total) * 100).toFixed(1) : 0}%)`);
  console.log('');

  // 4. まとめ
  console.log('=== まとめ ===\n');
  const lockRelated = allReasons.cloudflare_lock + allReasons.account_access;
  console.log(`ロック関連（Cloudflare + アカウントアクセス制限）: ${lockRelated}件 (${total > 0 ? ((lockRelated / total) * 100).toFixed(1) : 0}%)`);
  console.log(`アカウント問題（凍結 + ログイン画面）: ${allReasons.suspended + allReasons.login_required}件 (${total > 0 ? (((allReasons.suspended + allReasons.login_required) / total) * 100).toFixed(1) : 0}%)`);
  console.log('');

  console.log('=== 調査完了 ===');
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});





