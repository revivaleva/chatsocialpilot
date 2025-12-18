/**
 * プリセットID 14「いいね3点セット#コスメオタクプロフ」を更新
 * - db_container_nameを使用（命名規則に従う）
 * - フォロワー数とフォロー数を取得してx_accountsテーブルに保存
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
  
  // プロフィールページアクセスステップとフォロワー数確認ステップを探す
  let profileStepIndex = -1;
  let followerStepIndex = -1;
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.description && step.description.includes('プロフィールページにアクセス')) {
      profileStepIndex = i;
    }
    if (step.description && (step.description.includes('フォロワー数を確認') || step.description.includes('フォロワー数とフォロー数を確認'))) {
      followerStepIndex = i;
    }
  }
  
  if (profileStepIndex === -1 || followerStepIndex === -1) {
    console.error('❌ プロフィールページアクセスまたはフォロワー数確認ステップが見つかりません');
    console.error(`  プロフィールページアクセス: ステップ${profileStepIndex + 1}`);
    console.error(`  フォロワー数確認: ステップ${followerStepIndex + 1}`);
    process.exit(1);
  }
  
  console.log(`\n更新対象ステップ:`);
  console.log(`  ステップ${profileStepIndex + 1}: プロフィールページにアクセス → db_container_nameを使用`);
  console.log(`  ステップ${followerStepIndex + 1}: フォロワー数を確認 → フォロワー数とフォロー数を取得してDBに保存`);
  
  // ステップ1: プロフィールページにアクセス（db_container_nameを使用）
  const profileNavigateStep = {
    type: 'navigate',
    description: 'プロフィールページにアクセス',
    url: 'https://x.com/{{db_container_name}}',
    postWaitSeconds: 3,
    options: {
      timeoutMs: 30000
    }
  };
  
  // ステップ2: フォロワー数とフォロー数を取得してDBに保存
  const followerCheckStep = {
    type: 'eval',
    description: 'フォロワー数とフォロー数を確認',
    code: `
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
        const match = linkText.match(/([\\d,]+)/);
        if (match) {
          followerCount = parseInt(match[1].replace(/,/g, ''), 10);
        }
      }
      
      // フォロー数を取得
      if (followingLink) {
        const linkText = followingLink.textContent || followingLink.innerText || '';
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
          reason: \`フォロワー数: \${followerCount !== null ? followerCount : '取得失敗'}, フォロー数: \${followingCount !== null ? followingCount : '取得失敗'}\`
        };
      }
      
      return { 
        ok: false, 
        error: 'フォロワー数またはフォロー数が見つかりませんでした',
        didAction: false
      };
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
    console.log(`      URL: https://x.com/{{db_container_name}}`);
    console.log(`      注意: db_container_nameはタスク実行時にcontainerIdから自動取得されます（UIには表示されません）`);
    console.log(`   - ステップ${followerStepIndex + 1}: フォロワー数とフォロー数を確認 (eval)`);
    console.log(`      取得方法: verified_followers/followers と following リンクから取得`);
    console.log(`      保存先: x_accountsテーブルのfollower_countとfollowing_count`);
  } catch (e: any) {
    console.error('❌ プリセット更新に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

