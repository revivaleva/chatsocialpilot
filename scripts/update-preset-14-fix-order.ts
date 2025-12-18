/**
 * プリセットID 14「いいね3点セット#コスメオタクプロフ」を更新
 * - プロフィールページへのアクセスをフォロワー数確認の前に配置
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
  
  // 各ステップのインデックスを確認
  let profileStepIndex = -1;
  let followerCheckStepIndex = -1;
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const desc = step.description || step.name || '';
    
    if (desc.includes('プロフィールページにアクセス')) {
      profileStepIndex = i;
    }
    if (desc.includes('フォロワー数とフォロー数を確認') || desc.includes('フォロワー数を確認')) {
      followerCheckStepIndex = i;
    }
  }
  
  console.log(`\nステップインデックス:`);
  console.log(`  プロフィールページアクセス: ${profileStepIndex}`);
  console.log(`  フォロワー数確認: ${followerCheckStepIndex}`);
  
  if (profileStepIndex === -1 || followerCheckStepIndex === -1) {
    console.error('❌ 必要なステップが見つかりません');
    process.exit(1);
  }
  
  // ステップをコピー
  const updatedSteps = [...steps];
  
  // プロフィールページアクセスステップを取得
  const profileStep = updatedSteps[profileStepIndex];
  
  // 元の位置から削除
  updatedSteps.splice(profileStepIndex, 1);
  
  // フォロワー数確認ステップの前に挿入
  // 削除後、インデックスが変わっている可能性があるので、再度フォロワー数確認ステップのインデックスを確認
  let newFollowerCheckIndex = followerCheckStepIndex;
  if (profileStepIndex < followerCheckStepIndex) {
    newFollowerCheckIndex = followerCheckStepIndex - 1;
  }
  
  updatedSteps.splice(newFollowerCheckIndex, 0, profileStep);
  
  try {
    updatePreset(preset.id, preset.name, preset.description || '', JSON.stringify(updatedSteps));
    console.log(`\n✅ プリセットを更新しました:`);
    console.log(`   ID: ${preset.id}`);
    console.log(`   ステップ数: ${steps.length}（変更なし）`);
    console.log(`\n更新内容:`);
    console.log(`   - プロフィールページアクセス: フォロワー数確認の前に配置`);
    console.log(`\n新しいステップ順序:`);
    updatedSteps.forEach((s: any, i: number) => {
      const desc = s.description || s.name || s.type || 'unknown';
      console.log(`   ${i}: ${desc}`);
    });
  } catch (e: any) {
    console.error('❌ プリセット更新に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

