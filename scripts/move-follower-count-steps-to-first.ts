import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset, listPresets } from '../src/services/presets';

/**
 * 「いいね3点セット#美容好きな人と繋がりたい」プリセットの
 * フォロー数・フォロワー数取得・保存ステップを最後から最初に移動
 */

async function main() {
  initDb({ wal: true });
  
  console.log('=== フォロー数・フォロワー数取得・保存ステップを最初に移動 ===\n');
  
  // 対象プリセットを検索（ID 27を直接指定、または名前で検索）
  const allPresets = listPresets();
  let targetPreset = allPresets.find((p: any) => p.id === 27);
  if (!targetPreset) {
    targetPreset = allPresets.find((p: any) => 
      p.name && p.name.includes('いいね3点セット') && p.name.includes('美容好き')
    );
  }
  
  if (!targetPreset) {
    console.error('❌ 「いいね3点セット#美容好きな人と繋がりたい」プリセットが見つかりません');
    console.log('\n利用可能なプリセット:');
    allPresets.forEach((p: any) => {
      if (p.name && p.name.includes('いいね3点セット')) {
        console.log(`  ID ${p.id}: ${p.name}`);
      }
    });
    process.exit(1);
  }
  
  console.log(`対象プリセット: [${targetPreset.id}] ${targetPreset.name}\n`);
  
  const steps = JSON.parse(targetPreset.steps_json || '[]');
  if (!Array.isArray(steps)) {
    console.error('❌ steps_jsonが配列ではありません');
    process.exit(1);
  }
  
  console.log(`現在のステップ数: ${steps.length}\n`);
  
  // 最後の3ステップを特定（プロフィールアクセス、フォロワー数取得、DB保存）
  // 通常は最後から3つ: navigate (プロフィール), eval (取得), save_follower_count (保存)
  const lastSteps: any[] = [];
  const remainingSteps: any[] = [];
  
  // 最後から順に確認して、フォロワー数関連のステップを特定
  let foundProfileNavigate = false;
  let foundFollowerEval = false;
  let foundSaveStep = false;
  
  // 最後から逆順で確認
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    const stepName = step.name || step.description || '';
    
    // save_follower_count ステップ
    if (step.type === 'save_follower_count' && !foundSaveStep) {
      lastSteps.unshift(step);
      foundSaveStep = true;
      console.log(`  最後のステップ${i + 1}: save_follower_count (DB保存)`);
      continue;
    }
    
    // eval ステップで result_var が pr_follower_data
    if (step.type === 'eval' && step.result_var === 'pr_follower_data' && !foundFollowerEval) {
      lastSteps.unshift(step);
      foundFollowerEval = true;
      console.log(`  最後のステップ${i + 1}: eval (フォロワー数取得, result_var: pr_follower_data)`);
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
      console.log(`  最後のステップ${i + 1}: navigate (プロフィールページ)`);
      continue;
    }
    
    // それ以外は残す
    remainingSteps.unshift(step);
  }
  
  if (lastSteps.length === 0) {
    console.error('❌ フォロワー数関連のステップが見つかりませんでした');
    console.log('\n現在のステップ構成:');
    steps.forEach((step: any, i: number) => {
      const stepType = step.type || 'unknown';
      const stepName = step.name || step.description || '';
      console.log(`  ${i + 1}. ${stepType}: ${stepName}`);
    });
    process.exit(1);
  }
  
  console.log(`\n移動対象ステップ数: ${lastSteps.length}`);
  console.log(`残りのステップ数: ${remainingSteps.length}\n`);
  
  // 新しいステップ配列を作成（最後のステップを最初に移動）
  const newSteps = [...lastSteps, ...remainingSteps];
  
  console.log('新しいステップ順序:');
  newSteps.forEach((step: any, i: number) => {
    const stepType = step.type || 'unknown';
    const stepName = step.name || step.description || '';
    const marker = i < lastSteps.length ? ' ← 移動' : '';
    console.log(`  ${i + 1}. ${stepType}: ${stepName}${marker}`);
  });
  
  console.log('\n更新を実行しますか？ (y/n)');
  // 自動実行のため、確認なしで実行
  // 実際には確認が必要な場合は readline を使用
  
  try {
    updatePreset(
      targetPreset.id,
      targetPreset.name,
      targetPreset.description || '',
      JSON.stringify(newSteps)
    );
    console.log('\n✅ プリセットを更新しました');
    console.log(`   プリセットID: ${targetPreset.id}`);
    console.log(`   ステップ数: ${steps.length} → ${newSteps.length}`);
  } catch (e: any) {
    console.error(`\n❌ プリセット更新に失敗しました: ${e.message}`);
    process.exit(1);
  }
  
  console.log('\n✅ 完了');
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

