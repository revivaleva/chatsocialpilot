/**
 * プリセットID 14「いいね3点セット#コスメオタクプロフ」を更新
 * - プロフィールボタンクリックをURLアクセスに変更
 * - フォロワー数取得ロジックを改善
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
  
  // プロフィールボタンクリックステップとフォロワー数確認ステップを探す
  let profileStepIndex = -1;
  let followerStepIndex = -1;
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.description && step.description.includes('プロフィールボタンをクリック')) {
      profileStepIndex = i;
    }
    if (step.description && step.description.includes('フォロワー数を確認')) {
      followerStepIndex = i;
    }
  }
  
  if (profileStepIndex === -1 || followerStepIndex === -1) {
    console.error('❌ プロフィールボタンクリックまたはフォロワー数確認ステップが見つかりません');
    process.exit(1);
  }
  
  console.log(`\n更新対象ステップ:`);
  console.log(`  ステップ${profileStepIndex + 1}: プロフィールボタンをクリック → URLアクセスに変更`);
  console.log(`  ステップ${followerStepIndex + 1}: フォロワー数を確認 → 取得ロジックを改善`);
  
  // プロフィールページにアクセスするステップ（navigateに変更）
  // コンテナ名（XID）を使用してプロフィールページにアクセス
  const profileNavigateStep = {
    type: 'navigate',
    description: 'プロフィールページにアクセス',
    url: 'https://x.com/{{container_name}}',
    postWaitSeconds: 3,
    options: {
      timeoutMs: 30000
    }
  };
  
  // フォロワー数を取得するステップ（改善版）
  const followerCheckStep = {
    type: 'eval',
    description: 'フォロワー数を確認',
    code: `
      // フォロワー数のリンクを探す（複数のパターンを試す）
      // パターン1: verified_followers リンク（提供されたHTMLに基づく）
      let followerLink = document.querySelector('a[href*="/verified_followers"]');
      
      // パターン2: followers リンク
      if (!followerLink) {
        followerLink = document.querySelector('a[href*="/followers"]');
      }
      
      // パターン3: フォロワー数のテキストを含むリンクを探す
      if (!followerLink) {
        const allLinks = Array.from(document.querySelectorAll('a'));
        followerLink = allLinks.find(link => {
          const text = (link.textContent || link.innerText || '').toLowerCase();
          const href = (link.getAttribute('href') || '').toLowerCase();
          return (text.includes('フォロワー') || text.includes('follower')) && 
                 (href.includes('/followers') || href.includes('/verified_followers'));
        });
      }
      
      if (followerLink) {
        // リンク内のテキストから数値を抽出
        const linkText = followerLink.textContent || followerLink.innerText || '';
        // 例: "2 Followers" や "1,234 フォロワー" から数値を抽出
        const match = linkText.match(/([\\d,]+)/);
        if (match) {
          const followerCount = match[1].replace(/,/g, '');
          return { 
            ok: true, 
            followerCount: parseInt(followerCount, 10), 
            rawText: linkText.trim(),
            source: 'link'
          };
        }
      }
      
      // パターン4: プロフィールヘッダー内のフォロワー数表示を探す
      // 提供されたHTMLの構造に基づく: <div><a href="/naturequan32950/verified_followers">...</a></div>
      const profileHeader = document.querySelector('[data-testid="UserProfileHeader_Items"]') || 
                           document.querySelector('[data-testid="UserName"]')?.closest('div')?.parentElement;
      
      if (profileHeader) {
        const followerElements = profileHeader.querySelectorAll('a[href*="/followers"], a[href*="/verified_followers"]');
        for (const el of followerElements) {
          const text = (el.textContent || el.innerText || '').trim();
          const match = text.match(/([\\d,]+)\\s*(フォロワー|Followers|follower)/i);
          if (match) {
            const followerCount = match[1].replace(/,/g, '');
            return { 
              ok: true, 
              followerCount: parseInt(followerCount, 10), 
              rawText: text,
              source: 'profileHeader'
            };
          }
        }
      }
      
      // パターン5: ページ全体からフォロワー数を探す（最後の手段）
      const pageText = document.body.textContent || '';
      const textMatch = pageText.match(/([\\d,]+)\\s*(フォロワー|Followers|follower)/i);
      if (textMatch) {
        const followerCount = textMatch[1].replace(/,/g, '');
        return { 
          ok: true, 
          followerCount: parseInt(followerCount, 10), 
          rawText: textMatch[0],
          source: 'pageText'
        };
      }
      
      return { ok: false, error: 'フォロワー数が見つかりませんでした' };
    `,
    postWaitSeconds: 1
  };
  
  // ステップを更新
  const updatedSteps = [...steps];
  updatedSteps[profileStepIndex] = profileNavigateStep;
  updatedSteps[followerStepIndex] = followerCheckStep;
  
  try {
    updatePreset(preset.id, preset.name, preset.description || '', JSON.stringify(updatedSteps));
    console.log(`\n✅ プリセットを更新しました:`);
    console.log(`   ID: ${preset.id}`);
    console.log(`   ステップ数: ${steps.length}（変更なし）`);
    console.log(`\n更新されたステップ:`);
    console.log(`   - ステップ${profileStepIndex + 1}: プロフィールページにアクセス (navigate)`);
    console.log(`      URL: https://x.com/{{container_name}}`);
    console.log(`   - ステップ${followerStepIndex + 1}: フォロワー数を確認 (eval)`);
    console.log(`      取得方法: verified_followers/followers リンクから取得`);
  } catch (e: any) {
    console.error('❌ プリセット更新に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

