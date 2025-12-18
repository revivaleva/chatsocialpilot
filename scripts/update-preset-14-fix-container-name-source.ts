/**
 * プリセットID 14「いいね3点セット#コスメオタクプロフ」を更新
 * - 画面からコンテナ名を取得するステップを削除
 * - タスクのcontainerIdまたはx_accountsテーブルからコンテナ名を取得して使用
 * - フォロワー数・フォロー数の確認をフォローステップの後に移動
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
  let followStepIndex = -1;
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const desc = step.description || step.name || '';
    
    if (desc.includes('プロフィールページにアクセス')) {
      profileStepIndex = i;
    }
    if (desc.includes('フォロワー数とフォロー数を確認') || desc.includes('フォロワー数を確認')) {
      followerCheckStepIndex = i;
    }
    if (step.name === 'フォロー' || desc.includes('フォロー')) {
      followStepIndex = i;
    }
  }
  
  console.log(`\nステップインデックス:`);
  console.log(`  プロフィールページアクセス: ${profileStepIndex}`);
  console.log(`  フォロワー数確認: ${followerCheckStepIndex}`);
  console.log(`  フォロー: ${followStepIndex}`);
  
  if (profileStepIndex === -1) {
    console.error('❌ プロフィールページアクセスステップが見つかりません');
    process.exit(1);
  }
  
  if (followerCheckStepIndex === -1) {
    console.error('❌ フォロワー数確認ステップが見つかりません');
    process.exit(1);
  }
  
  if (followStepIndex === -1) {
    console.error('❌ フォローステップが見つかりません');
    process.exit(1);
  }
  
  // ステップをコピー
  const updatedSteps = [...steps];
  
  // 1. 画面からコンテナ名を取得するステップを削除（存在する場合）
  if (profileStepIndex > 0) {
    const prevStep = updatedSteps[profileStepIndex - 1];
    if (prevStep && prevStep.description && prevStep.description.includes('画面からコンテナ名')) {
      console.log(`\nステップ${profileStepIndex}（画面からコンテナ名を取得）を削除します`);
      updatedSteps.splice(profileStepIndex - 1, 1);
      profileStepIndex--;
      followerCheckStepIndex--;
      followStepIndex--;
    }
  }
  
  // 2. プロフィールページアクセスステップを更新（db_container_nameを使用）
  const newProfileStepIndex = profileStepIndex;
  updatedSteps[newProfileStepIndex] = {
    type: 'navigate',
    description: 'プロフィールページにアクセス',
    url: 'https://x.com/{{db_container_name}}',
    postWaitSeconds: 3,
    options: {
      timeoutMs: 30000
    }
  };
  
  // 3. フォロワー数・フォロー数確認ステップをフォローステップの後に移動
  const followerCheckStep = updatedSteps[followerCheckStepIndex];
  updatedSteps.splice(followerCheckStepIndex, 1);
  
  // フォローステップの後に挿入
  const newFollowerCheckIndex = followStepIndex;
  updatedSteps.splice(newFollowerCheckIndex + 1, 0, followerCheckStep);
  
  try {
    updatePreset(preset.id, preset.name, preset.description || '', JSON.stringify(updatedSteps));
    console.log(`\n✅ プリセットを更新しました:`);
    console.log(`   ID: ${preset.id}`);
    console.log(`   ステップ数: ${steps.length} → ${updatedSteps.length}`);
    console.log(`\n更新内容:`);
    console.log(`   - 画面からコンテナ名を取得するステップを削除`);
    console.log(`   - プロフィールページアクセス: db_container_nameを使用（タスクのcontainerIdまたはx_accountsテーブルから取得）`);
    console.log(`   - フォロワー数・フォロー数確認: フォローステップの後に移動`);
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

