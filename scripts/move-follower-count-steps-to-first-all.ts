import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset, listPresets } from '../src/services/presets';

/**
 * 全ての「いいね3点セット」プリセットの
 * フォロー数・フォロワー数取得・保存ステップを最後から最初に移動
 */

async function moveFollowerCountStepsToFirst(presetId: number): Promise<boolean> {
  const preset = getPreset(presetId);
  if (!preset) {
    console.log(`  ⚠️ プリセット ID ${presetId} が見つかりません`);
    return false;
  }
  
  const steps = JSON.parse(preset.steps_json || '[]');
  if (!Array.isArray(steps)) {
    console.log(`  ❌ steps_jsonが配列ではありません`);
    return false;
  }
  
  // 最後の3ステップを特定（プロフィールアクセス、フォロワー数取得、DB保存）
  const lastSteps: any[] = [];
  const remainingSteps: any[] = [];
  
  let foundProfileNavigate = false;
  let foundFollowerEval = false;
  let foundSaveStep = false;
  
  // 最後から逆順で確認
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    
    // save_follower_count ステップ
    if (step.type === 'save_follower_count' && !foundSaveStep) {
      lastSteps.unshift(step);
      foundSaveStep = true;
      continue;
    }
    
    // eval ステップで result_var が pr_follower_data
    if (step.type === 'eval' && step.result_var === 'pr_follower_data' && !foundFollowerEval) {
      lastSteps.unshift(step);
      foundFollowerEval = true;
      continue;
    }
    
    // navigate ステップで {{db_container_name}} を含む（プロフィールページ）
    if (step.type === 'navigate' && 
        step.url && 
        typeof step.url === 'string' && 
        step.url.includes('{{db_container_name}}') && 
        !foundProfileNavigate) {
      lastSteps.unshift(step);
      foundProfileNavigate = true;
      continue;
    }
    
    // それ以外は残す
    remainingSteps.unshift(step);
  }
  
  // 既に最初にあるかチェック（最初の3ステップがフォロワー数関連か）
  if (steps.length >= 3) {
    const first3 = steps.slice(0, 3);
    const alreadyMoved = 
      first3[0]?.type === 'navigate' && first3[0]?.url?.includes('{{db_container_name}}') &&
      first3[1]?.type === 'eval' && first3[1]?.result_var === 'pr_follower_data' &&
      first3[2]?.type === 'save_follower_count';
    
    if (alreadyMoved) {
      console.log(`  ✅ 既に最初に移動済みです`);
      return true;
    }
  }
  
  if (lastSteps.length === 0) {
    console.log(`  ⚠️ フォロワー数関連のステップが見つかりませんでした`);
    return false;
  }
  
  if (lastSteps.length !== 3) {
    console.log(`  ⚠️ フォロワー数関連のステップが3つではありません (${lastSteps.length}個)`);
    return false;
  }
  
  // 新しいステップ配列を作成（最後のステップを最初に移動）
  const newSteps = [...lastSteps, ...remainingSteps];
  
  try {
    updatePreset(
      preset.id,
      preset.name,
      preset.description || '',
      JSON.stringify(newSteps)
    );
    console.log(`  ✅ 更新完了 (ステップ数: ${steps.length} → ${newSteps.length})`);
    return true;
  } catch (e: any) {
    console.error(`  ❌ 更新失敗: ${e.message}`);
    return false;
  }
}

async function main() {
  initDb({ wal: true });
  
  console.log('=== フォロー数・フォロワー数取得・保存ステップを最初に移動（全プリセット） ===\n');
  
  // 対象プリセットを検索
  const allPresets = listPresets();
  const targetPresets = allPresets.filter((p: any) => 
    p.name && p.name.includes('いいね3点セット')
  );
  
  if (targetPresets.length === 0) {
    console.error('❌ 「いいね3点セット」プリセットが見つかりません');
    process.exit(1);
  }
  
  console.log(`対象プリセット数: ${targetPresets.length}\n`);
  
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  
  for (const preset of targetPresets) {
    console.log(`[${preset.id}] ${preset.name}`);
    const result = await moveFollowerCountStepsToFirst(preset.id);
    if (result === true) {
      successCount++;
    } else {
      errorCount++;
    }
    console.log('');
  }
  
  console.log('=== 完了 ===');
  console.log(`  成功: ${successCount}件`);
  console.log(`  エラー/スキップ: ${errorCount}件`);
  console.log(`  合計: ${targetPresets.length}件`);
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

