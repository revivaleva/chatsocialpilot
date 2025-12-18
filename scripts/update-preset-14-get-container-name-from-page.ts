/**
 * プリセットID 14「いいね3点セット#コスメオタクプロフ」を更新
 * - プロフィールページにアクセスする前に、画面からコンテナ名（ID）を取得するステップを追加
 * - 取得したコンテナ名を使用してプロフィールページにアクセス
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
  
  // プロフィールページアクセスステップを探す
  let profileStepIndex = -1;
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.description && step.description.includes('プロフィールページにアクセス')) {
      profileStepIndex = i;
      break;
    }
  }
  
  if (profileStepIndex === -1) {
    console.error('❌ プロフィールページアクセスステップが見つかりません');
    process.exit(1);
  }
  
  console.log(`\n更新対象ステップ:`);
  console.log(`  ステップ${profileStepIndex + 1}: プロフィールページにアクセス → 画面からコンテナ名を取得してからアクセス`);
  
  // ステップ1: 画面からコンテナ名（ID）を取得
  const getContainerNameFromPageStep = {
    type: 'eval',
    description: '画面からコンテナ名（ID）を取得',
    code: `
      // 現在のページからコンテナ名（XID）を取得
      // プロフィールページのURLから取得を試みる
      let containerName = null;
      
      // パターン1: URLから取得（例: https://x.com/username）
      const urlMatch = window.location.pathname.match(/^\\/([^\\/\\?]+)/);
      if (urlMatch && urlMatch[1] && !urlMatch[1].includes('search') && !urlMatch[1].includes('i') && !urlMatch[1].includes('explore')) {
        containerName = urlMatch[1];
      }
      
      // パターン2: プロフィールリンクから取得
      if (!containerName) {
        const profileLink = document.querySelector('a[href^="/"][data-testid*="Profile"], a[href^="/"][aria-label*="プロフィール"], a[href^="/"][aria-label*="Profile"]');
        if (profileLink) {
          const href = profileLink.getAttribute('href');
          if (href) {
            const match = href.match(/^\\/([^\\/\\?]+)/);
            if (match && match[1]) {
              containerName = match[1];
            }
          }
        }
      }
      
      // パターン3: ユーザー名要素から取得
      if (!containerName) {
        const userNameEl = document.querySelector('[data-testid="UserName"]');
        if (userNameEl) {
          const userLink = userNameEl.querySelector('a[href^="/"]');
          if (userLink) {
            const href = userLink.getAttribute('href');
            if (href) {
              const match = href.match(/^\\/([^\\/\\?]+)/);
              if (match && match[1] && !match[1].includes('status') && !match[1].includes('hashtag')) {
                containerName = match[1];
              }
            }
          }
        }
      }
      
      if (containerName) {
        return { 
          ok: true, 
          containerName: containerName,
          didAction: true,
          reason: \`コンテナ名を取得しました: \${containerName}\`
        };
      }
      
      return { 
        ok: false, 
        error: 'コンテナ名が見つかりませんでした',
        didAction: false
      };
    `,
    postWaitSeconds: 1
  };
  
  // ステップ2: プロフィールページにアクセス（取得したコンテナ名を使用）
  const profileNavigateStep = {
    type: 'navigate',
    description: 'プロフィールページにアクセス',
    url: 'https://x.com/{{containerName}}',
    postWaitSeconds: 3,
    options: {
      timeoutMs: 30000
    }
  };
  
  // ステップを更新（プロフィールページアクセスステップの前にコンテナ名取得ステップを挿入）
  const updatedSteps = [...steps];
  
  // 既存のプロフィールページアクセスステップを削除
  updatedSteps.splice(profileStepIndex, 1);
  
  // コンテナ名取得ステップとプロフィールページアクセスステップを挿入
  updatedSteps.splice(profileStepIndex, 0, getContainerNameFromPageStep, profileNavigateStep);
  
  try {
    updatePreset(preset.id, preset.name, preset.description || '', JSON.stringify(updatedSteps));
    console.log(`\n✅ プリセットを更新しました:`);
    console.log(`   ID: ${preset.id}`);
    console.log(`   ステップ数: ${steps.length} → ${updatedSteps.length}`);
    console.log(`\n更新されたステップ:`);
    console.log(`   - ステップ${profileStepIndex + 1}: 画面からコンテナ名（ID）を取得 (eval)`);
    console.log(`      取得方法: URL、プロフィールリンク、ユーザー名要素から取得`);
    console.log(`   - ステップ${profileStepIndex + 2}: プロフィールページにアクセス (navigate)`);
    console.log(`      URL: https://x.com/{{containerName}}`);
    console.log(`      注意: containerNameは前のステップで取得した値を使用`);
  } catch (e: any) {
    console.error('❌ プリセット更新に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

