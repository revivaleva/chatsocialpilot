/**
 * プリセットID 14「いいね3点セット#コスメオタクプロフ」を更新
 * - ステップ1の「プロフィールページにアクセス」をステップ6（フォロー）の後に移動
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
  let followStepIndex = -1;
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const desc = step.description || step.name || '';
    
    if (desc.includes('プロフィールページにアクセス')) {
      profileStepIndex = i;
    }
    if (step.name === 'フォロー' || desc.includes('フォロー')) {
      followStepIndex = i;
    }
  }
  
  console.log(`\nステップインデックス:`);
  console.log(`  プロフィールページアクセス: ${profileStepIndex}`);
  console.log(`  フォロー: ${followStepIndex}`);
  
  if (profileStepIndex === -1) {
    console.error('❌ プロフィールページアクセスステップが見つかりません');
    process.exit(1);
  }
  
  if (followStepIndex === -1) {
    console.error('❌ フォローステップが見つかりません');
    process.exit(1);
  }
  
  // ステップをコピー
  const updatedSteps = [...steps];
  
  // プロフィールページアクセスステップを取得
  const profileStep = updatedSteps[profileStepIndex];
  
  // 元の位置から削除
  updatedSteps.splice(profileStepIndex, 1);
  
  // フォローステップの後に挿入
  // 削除後、インデックスが変わっている可能性があるので、再度フォローステップのインデックスを確認
  let newFollowStepIndex = followStepIndex;
  if (profileStepIndex < followStepIndex) {
    newFollowStepIndex = followStepIndex - 1;
  }
  
  updatedSteps.splice(newFollowStepIndex + 1, 0, profileStep);
  
  try {
    updatePreset(preset.id, preset.name, preset.description || '', JSON.stringify(updatedSteps));
    console.log(`\n✅ プリセットを更新しました:`);
    console.log(`   ID: ${preset.id}`);
    console.log(`   ステップ数: ${steps.length}（変更なし）`);
    console.log(`\n更新内容:`);
    console.log(`   - プロフィールページアクセス: ステップ${profileStepIndex + 1} → ステップ${newFollowStepIndex + 2}（フォローの後）`);
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

