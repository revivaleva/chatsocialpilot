/**
 * フォロワー数取得プリセットのevalコードの構文エラーを修正
 * - suspended: locked → locked: true
 * - ログインページ検出の locked: true → suspended: true
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset, listPresets } from '../src/services/presets';

async function main() {
  initDb({ wal: true });
  
  // フォロワー数取得ステップを含むプリセットを探す
  const presets = listPresets();
  const targetPresets: Array<{ id: number; name: string; stepIndex: number }> = [];
  
  for (const preset of presets) {
    const steps = JSON.parse((preset as any).steps_json || '[]');
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === 'eval' && step.code) {
        const code = step.code || step.eval || '';
        // フォロワー数取得のevalステップを探す
        if (code.includes('フォロワー数') || code.includes('followerCount') || 
            (step.name && step.name.includes('フォロワー')) ||
            (step.description && step.description.includes('フォロワー'))) {
          targetPresets.push({ id: (preset as any).id, name: (preset as any).name, stepIndex: i });
          break;
        }
      }
    }
  }
  
  if (targetPresets.length === 0) {
    console.log('❌ フォロワー数取得ステップを含むプリセットが見つかりませんでした');
    process.exit(1);
  }
  
  console.log(`対象プリセット数: ${targetPresets.length}`);
  
  for (const target of targetPresets) {
    const preset = getPreset(target.id);
    if (!preset) {
      console.log(`⚠️ プリセット ID ${target.id} が見つかりません。スキップします。`);
      continue;
    }
    
    console.log(`\n[${target.id}] ${target.name}`);
    const steps = JSON.parse(preset.steps_json || '[]');
    const evalStep = steps[target.stepIndex];
    
    if (!evalStep || evalStep.type !== 'eval') {
      console.log(`  ⚠️ ステップ${target.stepIndex + 1}がevalステップではありません。スキップします。`);
      continue;
    }
    
    let currentCode = evalStep.code || evalStep.eval || '';
    const beforeCode = currentCode;
    
    // エラー1: suspended: locked → locked: true
    if (currentCode.includes('suspended: locked')) {
      currentCode = currentCode.replace(/suspended:\s*locked/g, 'locked: true');
      console.log(`  ✅ suspended: locked → locked: true に修正しました`);
    }
    
    // エラー1-2: locked: suspended → suspended: true
    if (currentCode.includes('locked: suspended')) {
      currentCode = currentCode.replace(/locked:\s*suspended/g, 'suspended: true');
      console.log(`  ✅ locked: suspended → suspended: true に修正しました`);
    }
    
    // エラー2: ログインページ検出の locked: suspended または locked: true → suspended: true
    // ログインページ検出ブロック内の locked: suspended または locked: true を suspended: true に
    if (currentCode.includes('ログインページが表示されています') && 
        (currentCode.includes('locked: suspended') || currentCode.includes('locked: true'))) {
      // ログインページ検出ブロック内の locked: suspended または locked: true を suspended: true に
      const loginCheckPattern = /(アカウントが凍結されている可能性があります\(ログインページが表示されています\)[\s\S]*?locked:\s*)(suspended|true)(\s*\}\s*;\s*\})/;
      if (loginCheckPattern.test(currentCode)) {
        currentCode = currentCode.replace(loginCheckPattern, '$1true$3');
        console.log(`  ✅ ログインページ検出の locked: suspended/true → suspended: true に修正しました`);
      } else {
        // より単純なパターンで置換
        currentCode = currentCode.replace(
          /(アカウントが凍結されている可能性があります\(ログインページが表示されています\)[\s\S]*?)locked:\s*(suspended|true)(\s*\}\s*;\s*\})/g,
          '$1suspended: true$3'
        );
        console.log(`  ✅ ログインページ検出の locked: suspended/true → suspended: true に修正しました（単純パターン）`);
      }
    }
    
    if (currentCode === beforeCode) {
      console.log(`  ✅ 修正が必要な箇所はありませんでした。`);
      continue;
    }
    
    // ステップを更新
    evalStep.code = currentCode;
    if (evalStep.eval) {
      evalStep.eval = currentCode;
    }
    steps[target.stepIndex] = evalStep;
    
    // プリセットを更新
    try {
      updatePreset(target.id, preset.name, preset.description || '', JSON.stringify(steps));
      console.log(`  ✅ プリセットを更新しました（ステップ${target.stepIndex + 1}）`);
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






