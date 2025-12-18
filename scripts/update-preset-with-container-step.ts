/**
 * X Authログインプリセット（ID: 16）を「コンテナ指定」ステップに更新するスクリプト
 * 
 * 使用方法:
 *   npx tsx scripts/update-preset-with-container-step.ts
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset } from '../src/services/presets';

async function main() {
  // DBを初期化
  initDb({ wal: true });
  
  const presetId = 16;
  const preset = getPreset(presetId);
  
  if (!preset) {
    console.error(`❌ プリセット ID ${presetId} が見つかりません`);
    process.exit(1);
  }
  
  console.log(`現在のプリセット情報:`);
  console.log(`  ID: ${preset.id}`);
  console.log(`  名前: ${preset.name}`);
  
  // ステップを取得
  const steps = JSON.parse(preset.steps_json || '[]');
  console.log(`  現在のステップ数: ${steps.length}`);
  
  // 最初のステップが「コンテナ指定」ステップかどうか確認
  const hasContainerStep = steps.length > 0 && 
    (steps[0].type === 'container' || steps[0].type === 'open_container');
  
  if (hasContainerStep) {
    console.log(`\n✅ 「コンテナ指定」ステップは既に追加されています`);
    process.exit(0);
  }
  
  // 最初のステップがコンテナ名取得ステップ（eval）の場合は削除
  let updatedSteps = [...steps];
  if (updatedSteps.length > 0 && 
      updatedSteps[0].type === 'eval' && 
      updatedSteps[0].description && 
      updatedSteps[0].description.includes('コンテナ名を取得')) {
    console.log(`  最初のステップ（コンテナ名取得用eval）を削除`);
    updatedSteps = updatedSteps.slice(1);
  }
  
  // 「コンテナ指定」ステップを先頭に追加
  const containerStep = {
    type: 'container',
    description: 'コンテナ指定',
    container_name: '{{container_name}}',
    postWaitSeconds: 1
  };
  
  updatedSteps = [containerStep, ...updatedSteps];
  
  try {
    updatePreset(presetId, preset.name, preset.description, JSON.stringify(updatedSteps));
    console.log(`\n✅ プリセットを更新しました:`);
    console.log(`   ID: ${presetId}`);
    console.log(`   ステップ数: ${updatedSteps.length}（コンテナ指定ステップを追加）`);
    console.log(`\n追加されたステップ:`);
    console.log(`   - ステップ1: コンテナ指定（{{container_name}}でコンテナを開く）`);
    console.log(`\nこれで、ステップ1でコンテナが開かれ、その後のステップで使用されます`);
  } catch (e: any) {
    console.error('❌ プリセット更新に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

