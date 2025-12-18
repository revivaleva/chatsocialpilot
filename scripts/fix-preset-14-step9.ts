/**
 * プリセットID 14のステップ9をsave_follower_countタイプに修正
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
  
  const steps = JSON.parse(preset.steps_json || '[]');
  console.log(`プリセット ID ${presetId}: ${preset.name}`);
  console.log(`現在のステップ数: ${steps.length}`);
  
  // ステップ8にresult_varが設定されているか確認
  if (steps[7] && steps[7].type === 'eval') {
    if (!steps[7].result_var) {
      steps[7].result_var = 'pr_follower_data';
      console.log('✅ ステップ8にresult_varを追加しました');
    } else {
      console.log(`✅ ステップ8のresult_var: ${steps[7].result_var}`);
    }
  }
  
  // ステップ9をsave_follower_countタイプに修正
  if (steps[8]) {
    if (steps[8].type !== 'save_follower_count') {
      steps[8] = {
        type: 'save_follower_count',
        description: 'フォロワー数とフォロー数をDBに保存'
      };
      console.log('✅ ステップ9をsave_follower_countタイプに修正しました');
    } else {
      console.log('✅ ステップ9は既にsave_follower_countタイプです');
    }
  } else {
    // ステップ9が存在しない場合は追加
    steps.push({
      type: 'save_follower_count',
      description: 'フォロワー数とフォロー数をDBに保存'
    });
    console.log('✅ ステップ9を追加しました');
  }
  
  try {
    updatePreset(preset.id, preset.name, preset.description || '', JSON.stringify(steps));
    console.log(`\n✅ プリセット ID ${presetId} を更新しました`);
    console.log(`   最終ステップ数: ${steps.length}`);
  } catch (e: any) {
    console.error('❌ プリセット更新に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});













