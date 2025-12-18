/**
 * プリセットID 14「いいね3点セット#コスメオタクプロフ」を更新
 * - ステップ7のevalコードを修正（構文エラーとHTML構造の対応）
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
  
  // フォロワー数確認ステップを探す
  let followerCheckStepIndex = -1;
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const desc = step.description || step.name || '';
    if (desc.includes('フォロワー数とフォロー数を確認') || desc.includes('フォロワー数を確認')) {
      followerCheckStepIndex = i;
      break;
    }
  }
  
  if (followerCheckStepIndex === -1) {
    console.error('❌ フォロワー数確認ステップが見つかりません');
    process.exit(1);
  }
  
  console.log(`\n更新対象ステップ:`);
  console.log(`  ステップ${followerCheckStepIndex + 1}: フォロワー数とフォロー数を確認 (evalコードを修正)`);
  
  // 修正したevalコード（構文エラーを修正、HTML構造に対応）
  const fixedFollowerCheckStep = {
    type: 'eval',
    description: 'フォロワー数とフォロー数を確認',
    code: `(function() {
      try {
        // フォロワー数とフォロー数のリンクを探す
        let followerLink = document.querySelector('a[href*="/verified_followers"]');
        let followingLink = document.querySelector('a[href*="/following"]');
        
        // パターン2: 通常のfollowers/followingリンク
        if (!followerLink) {
          followerLink = document.querySelector('a[href*="/followers"]');
        }
        if (!followingLink) {
          followingLink = document.querySelector('a[href*="/following"]');
        }
        
        // パターン3: プロフィールヘッダー内を探す
        const profileHeader = document.querySelector('[data-testid="UserProfileHeader_Items"]') || 
                             document.querySelector('[data-testid="UserName"]')?.closest('div')?.parentElement;
        
        if (profileHeader) {
          if (!followerLink) {
            followerLink = profileHeader.querySelector('a[href*="/followers"], a[href*="/verified_followers"]');
          }
          if (!followingLink) {
            followingLink = profileHeader.querySelector('a[href*="/following"]');
          }
        }
        
        let followerCount = null;
        let followingCount = null;
        
        // フォロワー数を取得
        if (followerLink) {
          const linkText = followerLink.textContent || followerLink.innerText || '';
          // 数値とカンマを含むパターンを探す（例: "1" や "1,234"）
          const match = linkText.match(/([\\d,]+)/);
          if (match) {
            followerCount = parseInt(match[1].replace(/,/g, ''), 10);
          }
        }
        
        // フォロー数を取得
        if (followingLink) {
          const linkText = followingLink.textContent || followingLink.innerText || '';
          // 数値とカンマを含むパターンを探す（例: "5" や "5,678"）
          const match = linkText.match(/([\\d,]+)/);
          if (match) {
            followingCount = parseInt(match[1].replace(/,/g, ''), 10);
          }
        }
        
        // パターン4: プロフィールヘッダー内のテキストから直接取得
        if (profileHeader && (followerCount === null || followingCount === null)) {
          const headerText = profileHeader.textContent || '';
          // フォロワー数を探す
          if (followerCount === null) {
            const followerMatch = headerText.match(/([\\d,]+)\\s*(フォロワー|Followers|follower)/i);
            if (followerMatch) {
              followerCount = parseInt(followerMatch[1].replace(/,/g, ''), 10);
            }
          }
          // フォロー数を探す
          if (followingCount === null) {
            const followingMatch = headerText.match(/([\\d,]+)\\s*(フォロー|Following)/i);
            if (followingMatch) {
              followingCount = parseInt(followingMatch[1].replace(/,/g, ''), 10);
            }
          }
        }
        
        if (followerCount !== null || followingCount !== null) {
          return { 
            ok: true, 
            followerCount: followerCount,
            followingCount: followingCount,
            didAction: true,
            reason: 'フォロワー数: ' + (followerCount !== null ? followerCount : '取得失敗') + ', フォロー数: ' + (followingCount !== null ? followingCount : '取得失敗')
          };
        }
        
        return { 
          ok: false, 
          error: 'フォロワー数またはフォロー数が見つかりませんでした',
          didAction: false
        };
      } catch (e) {
        return {
          ok: false,
          error: 'エラーが発生しました: ' + (e.message || String(e)),
          didAction: false
        };
      }
    })()`,
    postWaitSeconds: 1
  };
  
  // ステップを更新
  const updatedSteps = [...steps];
  updatedSteps[followerCheckStepIndex] = fixedFollowerCheckStep;
  
  try {
    updatePreset(preset.id, preset.name, preset.description || '', JSON.stringify(updatedSteps));
    console.log(`\n✅ プリセットを更新しました:`);
    console.log(`   ID: ${preset.id}`);
    console.log(`   ステップ数: ${steps.length}（変更なし）`);
    console.log(`\n更新内容:`);
    console.log(`   - ステップ${followerCheckStepIndex + 1}: フォロワー数とフォロー数を確認 (eval)`);
    console.log(`      修正内容:`);
    console.log(`        - コードを即時実行関数でラップ`);
    console.log(`        - try-catchでエラーハンドリングを追加`);
    console.log(`        - テンプレートリテラルを文字列連結に変更（構文エラー回避）`);
    console.log(`        - 正規表現のエスケープを修正`);
  } catch (e: any) {
    console.error('❌ プリセット更新に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

