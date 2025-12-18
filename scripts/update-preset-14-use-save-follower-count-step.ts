/**
 * プリセットID 14「いいね3点セット#コスメオタクプロフ」を更新
 * - フォロワー数・フォロー数確認のevalステップにresult_varを追加（pr_follower_data）
 * - 新しいsave_follower_countステップを追加してDBに保存
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset } from '../src/services/presets';

async function main() {
  initDb({ wal: true });
  
  const presetId = 14;
  const preset = getPreset(presetId);
  
  if (!preset) {
    console.error(`❌ プリセット ID ${presetId} が見つかりません`);
    process.exit(1);
  }
  
  console.log(`対象プリセット:`);
  console.log(`  ID: ${preset.id}`);
  console.log(`  名前: ${preset.name}`);
  
  // ステップを取得
  const steps = JSON.parse(preset.steps_json || '[]');
  console.log(`  現在のステップ数: ${steps.length}`);
  
  // フォロワー数確認ステップを探す
  let followerCheckStepIndex = -1;
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const desc = step.description || step.name || '';
    if (desc.includes('フォロワー数とフォロー数を確認') || desc.includes('フォロワー数を確認')) {
      followerCheckStepIndex = i;
      break;
    }
  }
  
  if (followerCheckStepIndex === -1) {
    console.error('❌ フォロワー数確認ステップが見つかりません');
    process.exit(1);
  }
  
  console.log(`\n更新対象ステップ:`);
  console.log(`  ステップ${followerCheckStepIndex + 1}: フォロワー数とフォロー数を確認 (evalにresult_varを追加)`);
  console.log(`  新規追加: save_follower_countステップ`);
  
  // ステップをコピー
  const updatedSteps = [...steps];
  
  // 1. evalステップにresult_varを追加
  const followerCheckStep = updatedSteps[followerCheckStepIndex];
  if (followerCheckStep.type === 'eval') {
    followerCheckStep.result_var = 'pr_follower_data';
    console.log(`  - result_var: pr_follower_data を追加`);
  }
  
  // 2. save_follower_countステップを追加
  const saveFollowerCountStep = {
    type: 'save_follower_count',
    description: 'フォロワー数とフォロー数をDBに保存',
  };
  
  updatedSteps.splice(followerCheckStepIndex + 1, 0, saveFollowerCountStep);
  
  try {
    updatePreset(preset.id, preset.name, preset.description || '', JSON.stringify(updatedSteps));
    console.log(`\n✅ プリセットを更新しました:`);
    console.log(`   ID: ${preset.id}`);
    console.log(`   ステップ数: ${steps.length} → ${updatedSteps.length}`);
    console.log(`\n更新内容:`);
    console.log(`   - ステップ${followerCheckStepIndex + 1}: フォロワー数とフォロー数を確認 (eval)`);
    console.log(`     result_var: pr_follower_data を追加`);
    console.log(`     → evalステップの結果がpr_follower_dataに保存され、followerCount/followingCountが自動的にpr_follower_count/pr_following_countに設定されます`);
    console.log(`   - ステップ${followerCheckStepIndex + 2}: フォロワー数とフォロー数をDBに保存 (save_follower_count)`);
    console.log(`     → pr_follower_countとpr_following_countから値を取得してx_accountsテーブルに保存`);
    console.log(`     → 実行ログに保存した値が出力されます`);
  } catch (e: any) {
    console.error('❌ プリセット更新に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

