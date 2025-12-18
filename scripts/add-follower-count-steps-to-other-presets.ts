/**
 * 他の「いいね3点セット」プリセットに、ID14と同じフォロワー数取得・保存ステップを追加
 * 対象: ID15, 19, 23, 24, 25, 26, 27
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset } from '../src/services/presets';

async function main() {
  initDb({ wal: true });
  
  // ID14から正しいステップ7,8,9を取得
  const preset14 = getPreset(14);
  if (!preset14) {
    console.error('❌ プリセット ID 14 が見つかりません');
    process.exit(1);
  }
  
  const steps14 = JSON.parse(preset14.steps_json || '[]');
  if (steps14.length < 9) {
    console.error('❌ ID14のステップ数が不足しています');
    process.exit(1);
  }
  
  // ステップ7: navigate (プロフィールページにアクセス)
  const step7 = steps14[6];
  // ステップ8: eval (フォロワー数とフォロー数を確認)
  const step8 = steps14[7];
  // ステップ9: save_follower_count (DBに保存)
  const step9 = steps14[8];
  
  // ステップ8にresult_varが設定されているか確認
  if (!step8.result_var) {
    step8.result_var = 'pr_follower_data';
    console.log('⚠️ ID14のステップ8にresult_varが設定されていませんでした。追加します。');
  }
  
  // ステップ9がsave_follower_countタイプでない場合は修正
  if (step9.type !== 'save_follower_count') {
    step9.type = 'save_follower_count';
    step9.description = 'フォロワー数とフォロー数をDBに保存';
    delete step9.url;
    delete step9.name;
    delete step9.postWaitSeconds;
    delete step9.options;
    console.log('⚠️ ID14のステップ9をsave_follower_countタイプに修正しました。');
  }
  
  // 対象プリセットID
  const targetPresetIds = [15, 19, 23, 24, 25, 26, 27];
  
  for (const presetId of targetPresetIds) {
    const preset = getPreset(presetId);
    if (!preset) {
      console.log(`⚠️ プリセット ID ${presetId} が見つかりません。スキップします。`);
      continue;
    }
    
    console.log(`\n[${presetId}] ${preset.name}`);
    const steps = JSON.parse(preset.steps_json || '[]');
    console.log(`  現在のステップ数: ${steps.length}`);
    
    // 既に追加済みかチェック
    const hasStep7 = steps.some((s: any, i: number) => 
      i >= 6 && s.type === 'navigate' && s.url && s.url.includes('{{db_container_name}}')
    );
    const hasStep8 = steps.some((s: any) => 
      s.type === 'eval' && s.result_var === 'pr_follower_data'
    );
    const hasStep9 = steps.some((s: any) => s.type === 'save_follower_count');
    
    if (hasStep7 && hasStep8 && hasStep9) {
      console.log(`  ✅ 既に追加済みです。スキップします。`);
      continue;
    }
    
    // フォローステップの位置を探す（通常は最後のステップ）
    let followStepIndex = -1;
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      const desc = step.description || step.name || '';
      if (desc.includes('フォロー') && step.type === 'eval') {
        followStepIndex = i;
        break;
      }
    }
    
    if (followStepIndex === -1) {
      console.log(`  ⚠️ フォローステップが見つかりません。スキップします。`);
      continue;
    }
    
    console.log(`  フォローステップ位置: ${followStepIndex + 1}`);
    
    // 新しいステップ配列を作成
    const updatedSteps = [...steps];
    
    // 既存のステップ7,8,9があれば削除
    for (let i = updatedSteps.length - 1; i >= followStepIndex + 1; i--) {
      const step = updatedSteps[i];
      if (
        (step.type === 'navigate' && step.url && step.url.includes('{{db_container_name}}')) ||
        (step.type === 'eval' && step.result_var === 'pr_follower_data') ||
        step.type === 'save_follower_count'
      ) {
        updatedSteps.splice(i, 1);
        console.log(`  既存のステップ${i + 1}を削除しました。`);
      }
    }
    
    // フォローステップの後に3つのステップを追加
    // ステップ7: navigate
    updatedSteps.splice(followStepIndex + 1, 0, { ...step7 });
    // ステップ8: eval
    updatedSteps.splice(followStepIndex + 2, 0, { ...step8 });
    // ステップ9: save_follower_count
    updatedSteps.splice(followStepIndex + 3, 0, { ...step9 });
    
    console.log(`  新しいステップ数: ${updatedSteps.length}`);
    console.log(`  追加したステップ:`);
    console.log(`    ${followStepIndex + 2}. navigate: プロフィールページにアクセス`);
    console.log(`    ${followStepIndex + 3}. eval: フォロワー数とフォロー数を確認 (result_var: ${step8.result_var})`);
    console.log(`    ${followStepIndex + 4}. save_follower_count: DBに保存`);
    
    try {
      updatePreset(preset.id, preset.name, preset.description || '', JSON.stringify(updatedSteps));
      console.log(`  ✅ プリセットを更新しました`);
    } catch (e: any) {
      console.error(`  ❌ プリセット更新に失敗しました:`, e.message);
    }
  }
  
  console.log('\n✅ 全てのプリセットの更新が完了しました');
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});













