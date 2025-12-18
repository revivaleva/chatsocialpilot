/**
 * フォロワー数取得・保存プリセットを更新
 * - 「アカウントは凍結されています」テキストの検出を追加
 * - 凍結検出時にログに記録されるようにする
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
    
    const currentCode = evalStep.code || evalStep.eval || '';
    
    // 既に「アカウントは凍結されています」の検出が含まれているかチェック
    const hasSuspendedCheck = currentCode.includes('アカウントは凍結されています') || 
                              currentCode.includes('empty_state_header_text');
    const hasCloudflareCheck = currentCode.includes('以下のアクションを完了して') ||
                               currentCode.includes('cf-turnstile-response') ||
                               currentCode.includes('Cloudflareチャレンジ');
    
    if (hasSuspendedCheck && hasCloudflareCheck) {
      console.log(`  ✅ 既に全ての凍結検出コードが含まれています。スキップします。`);
      continue;
    }
    
    // 凍結検出コードを追加
    let updatedCode = currentCode;
    
    // 「アカウントは凍結されています」の検出コードを追加（まだ含まれていない場合）
    if (!hasSuspendedCheck) {
      // 既存の凍結検出部分を探す（ログインページ検出）
      const loginCheckPattern = /\/\/ アカウント凍結検出:.*?ログインページが表示されているかチェック/s;
      const match = updatedCode.match(loginCheckPattern);
      
      if (match) {
        // 既存のログインページ検出コードの前に「アカウントは凍結されています」の検出を追加
        const beforeLoginCheck = updatedCode.substring(0, match.index);
        const loginCheck = match[0];
        const afterLoginCheck = updatedCode.substring(match.index! + match[0].length);
        
        const suspendedCheck = `        // アカウント凍結検出: 「アカウントは凍結されています」テキストの検出
        const suspendedHeader = document.querySelector('[data-testid="empty_state_header_text"]');
        const suspendedText = suspendedHeader?.textContent?.includes('アカウントは凍結されています');
        
        if (suspendedText) {
          return {
            ok: false,
            error: 'アカウントは凍結されています',
            didAction: false,
            suspended: true
          };
        }
        
`;
        
        updatedCode = beforeLoginCheck + suspendedCheck + loginCheck + afterLoginCheck;
      } else {
        // 既存の凍結検出コードがない場合、tryブロックの直後に追加
        const tryPattern = /(function\(\)\s*\{[\s\n]*try\s*\{)/;
        const tryMatch = updatedCode.match(tryPattern);
        
        if (tryMatch) {
          const beforeTry = updatedCode.substring(0, tryMatch.index! + tryMatch[0].length);
          const afterTry = updatedCode.substring(tryMatch.index! + tryMatch[0].length);
          
          const suspendedCheck = `        // アカウント凍結検出: 「アカウントは凍結されています」テキストの検出
        const suspendedHeader = document.querySelector('[data-testid="empty_state_header_text"]');
        const suspendedText = suspendedHeader?.textContent?.includes('アカウントは凍結されています');
        
        if (suspendedText) {
          return {
            ok: false,
            error: 'アカウントは凍結されています',
            didAction: false,
            suspended: true
          };
        }
        
`;
          
          updatedCode = beforeTry + suspendedCheck + afterTry;
        } else {
          console.log(`  ⚠️ コード構造を解析できませんでした。手動で確認してください。`);
          continue;
        }
      }
    }
    
    // Cloudflareチャレンジページの検出コードを追加（まだ含まれていない場合）
    if (!hasCloudflareCheck) {
      // 既存の凍結検出コードの後に追加
      // 「アカウントは凍結されています」の検出コードの後に追加
      const suspendedCheckPattern = /\/\/ アカウント凍結検出:.*?「アカウントは凍結されています」テキストの検出.*?suspended:\s*true\s*\}\s*;\s*\}/s;
      const suspendedMatch = updatedCode.match(suspendedCheckPattern);
      
      if (suspendedMatch) {
        // 「アカウントは凍結されています」の検出コードの後にCloudflareチャレンジの検出を追加
        const beforeSuspendedCheck = updatedCode.substring(0, suspendedMatch.index! + suspendedMatch[0].length);
        const afterSuspendedCheck = updatedCode.substring(suspendedMatch.index! + suspendedMatch[0].length);
        
        const cloudflareCheck = `
        // Cloudflareチャレンジページの検出（ロック状態、suspendedとは別扱い）
        const cloudflareChallengeText = document.body.textContent?.includes('以下のアクションを完了して、あなたが人間であることを確認してください。');
        const cloudflareChallengeElement = document.querySelector('#cf-chl-widget-jag95_response, [id*="cf-chl-widget"], [name="cf-turnstile-response"]');
        
        if (cloudflareChallengeText || cloudflareChallengeElement) {
          return {
            ok: false,
            error: 'Cloudflareチャレンジページが表示されています（アカウントがロックされている可能性があります）',
            didAction: false,
            locked: true
          };
        }
        
`;
        
        updatedCode = beforeSuspendedCheck + cloudflareCheck + afterSuspendedCheck;
      } else {
        // 「アカウントは凍結されています」の検出コードがない場合、ログインページ検出の前に追加
        const loginCheckPattern = /\/\/ アカウント凍結検出:.*?ログインページが表示されているかチェック/s;
        const loginMatch = updatedCode.match(loginCheckPattern);
        
        if (loginMatch) {
          const beforeLoginCheck = updatedCode.substring(0, loginMatch.index);
          const loginCheck = loginMatch[0];
          const afterLoginCheck = updatedCode.substring(loginMatch.index! + loginMatch[0].length);
          
          const cloudflareCheck = `        // Cloudflareチャレンジページの検出（ロック状態、suspendedとは別扱い）
        const cloudflareChallengeText = document.body.textContent?.includes('以下のアクションを完了して、あなたが人間であることを確認してください。');
        const cloudflareChallengeElement = document.querySelector('#cf-chl-widget-jag95_response, [id*="cf-chl-widget"], [name="cf-turnstile-response"]');
        
        if (cloudflareChallengeText || cloudflareChallengeElement) {
          return {
            ok: false,
            error: 'Cloudflareチャレンジページが表示されています（アカウントがロックされている可能性があります）',
            didAction: false,
            locked: true
          };
        }
        
`;
          
          updatedCode = beforeLoginCheck + cloudflareCheck + loginCheck + afterLoginCheck;
        } else {
          // tryブロックの直後に追加
          const tryPattern = /(function\(\)\s*\{[\s\n]*try\s*\{)/;
          const tryMatch = updatedCode.match(tryPattern);
          
          if (tryMatch) {
            const beforeTry = updatedCode.substring(0, tryMatch.index! + tryMatch[0].length);
            const afterTry = updatedCode.substring(tryMatch.index! + tryMatch[0].length);
            
            const cloudflareCheck = `        // Cloudflareチャレンジページの検出（ロック状態、suspendedとは別扱い）
        const cloudflareChallengeText = document.body.textContent?.includes('以下のアクションを完了して、あなたが人間であることを確認してください。');
        const cloudflareChallengeElement = document.querySelector('#cf-chl-widget-jag95_response, [id*="cf-chl-widget"], [name="cf-turnstile-response"]');
        
        if (cloudflareChallengeText || cloudflareChallengeElement) {
          return {
            ok: false,
            error: 'Cloudflareチャレンジページが表示されています（アカウントがロックされている可能性があります）',
            didAction: false,
            locked: true
          };
        }
        
`;
            
            updatedCode = beforeTry + cloudflareCheck + afterTry;
          } else {
            console.log(`  ⚠️ コード構造を解析できませんでした。手動で確認してください。`);
            continue;
          }
        }
      }
    }
    
    // ステップを更新
    evalStep.code = updatedCode;
    if (evalStep.eval) {
      evalStep.eval = updatedCode;
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
