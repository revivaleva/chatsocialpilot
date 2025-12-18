/**
 * フォロワー数取得プリセットのCloudflareチャレンジ検出を修正
 * - suspended: true → locked: true に変更
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
    
    // Cloudflareチャレンジ検出でsuspended: trueになっている場合、locked: trueに変更
    if (currentCode.includes('Cloudflareチャレンジ')) {
      const beforeReplace = currentCode;
      
      // Cloudflareチャレンジ検出ブロック内のsuspended: trueをlocked: trueに置換
      // パターン: // Cloudflareチャレンジページの検出 から始まるブロック内のsuspended: trueをlocked: trueに
      const cloudflareCommentIndex = currentCode.indexOf('// Cloudflareチャレンジページの検出');
      if (cloudflareCommentIndex >= 0) {
        // Cloudflareチャレンジ検出ブロックの開始位置を特定
        const blockStart = cloudflareCommentIndex;
        // 次の検出ブロックまたは関数の終了までを範囲とする
        const nextCheckIndex = currentCode.indexOf('// アカウント凍結検出:', blockStart + 1);
        const blockEnd = nextCheckIndex > 0 ? nextCheckIndex : currentCode.length;
        
        // ブロック内のsuspended: trueをlocked: trueに置換
        const beforeBlock = currentCode.substring(0, blockStart);
        const blockContent = currentCode.substring(blockStart, blockEnd);
        const afterBlock = currentCode.substring(blockEnd);
        
        // ブロック内でsuspended: trueをlocked: trueに置換
        const updatedBlock = blockContent.replace(/suspended:\s*true/g, 'locked: true');
        
        if (updatedBlock !== blockContent) {
          currentCode = beforeBlock + updatedBlock + afterBlock;
          console.log(`  ✅ Cloudflareチャレンジ検出をlocked: trueに変更しました`);
        } else if (blockContent.includes('locked: true')) {
          console.log(`  ✅ 既にlocked: trueになっています。スキップします。`);
          continue;
        } else {
          console.log(`  ⚠️ Cloudflareチャレンジ検出ブロック内にsuspended: trueが見つかりませんでした。`);
          continue;
        }
      } else {
        console.log(`  ⚠️ Cloudflareチャレンジ検出のコメントが見つかりませんでした。`);
        continue;
      }
      
      if (currentCode === beforeReplace) {
        console.log(`  ⚠️ 置換が実行されませんでした。`);
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
    } else if (currentCode.includes('locked: true') && currentCode.includes('Cloudflare')) {
      console.log(`  ✅ 既にlocked: trueになっています。スキップします。`);
    } else {
      console.log(`  ⚠️ Cloudflareチャレンジ検出コードが見つかりませんでした。`);
    }
  }
  
  console.log('\n✅ 全てのプリセットの更新が完了しました');
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});
