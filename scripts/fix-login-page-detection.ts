/**
 * フォロワー数取得プリセットのログインページ検出を修正
 * - ログインページ検出は suspended: true ではなく login_required: true に変更
 * - suspended: true は「アカウントは凍結されています」の文言がある時のみ
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
    
    // ログインページ検出ブロックを探す
    // ログインページが表示されている場合のreturn文で suspended: true を login_required: true に変更
    if (currentCode.includes('ログインページが表示されています') && currentCode.includes('suspended: true')) {
      // より直接的な置換: ログインページ検出のreturn文内の suspended: true を login_required: true に
      const beforeReplace = currentCode;
      
      // パターン1: ログインページ検出のreturn文全体を置換
      currentCode = currentCode.replace(
        /(アカウントが凍結されている可能性があります\(ログインページが表示されています\)[\s\S]*?)suspended:\s*true(\s*\}\s*;\s*\})/g,
        '$1login_required: true$2'
      );
      
      // パターン2: より広範囲な置換（ログインページ検出ブロック内の suspended: true を全て login_required: true に）
      if (currentCode === beforeReplace) {
        const loginIndex = currentCode.indexOf('ログインページが表示されています');
        if (loginIndex >= 0) {
          // ログインページ検出ブロックの開始から次の検出ブロックまで
          const nextCheckIndex = currentCode.indexOf('// フォロワー数とフォロー数のリンクを探す', loginIndex);
          const blockEnd = nextCheckIndex > 0 ? nextCheckIndex : currentCode.length;
          
          const beforeBlock = currentCode.substring(0, loginIndex);
          const loginBlock = currentCode.substring(loginIndex, blockEnd);
          const afterBlock = currentCode.substring(blockEnd);
          
          const updatedLoginBlock = loginBlock.replace(/suspended:\s*true/g, 'login_required: true');
          
          if (updatedLoginBlock !== loginBlock) {
            currentCode = beforeBlock + updatedLoginBlock + afterBlock;
            console.log(`  ✅ ログインページ検出を login_required: true に変更しました（広範囲パターン）`);
          }
        }
      } else {
        console.log(`  ✅ ログインページ検出を login_required: true に変更しました`);
      }
      
      if (currentCode === beforeReplace) {
        // 既に login_required: true になっているか確認
        if (currentCode.includes('login_required: true') && currentCode.includes('ログインページが表示されています')) {
          console.log(`  ✅ 既に login_required: true になっています。スキップします。`);
          continue;
        } else {
          console.log(`  ⚠️ ログインページ検出ブロック内に suspended: true が見つかりませんでした。`);
          continue;
        }
      }
    } else if (currentCode.includes('login_required: true') && currentCode.includes('ログインページが表示されています')) {
      console.log(`  ✅ 既に login_required: true になっています。スキップします。`);
      continue;
    } else {
      console.log(`  ⚠️ ログインページ検出ブロックが見つかりませんでした。`);
      continue;
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






