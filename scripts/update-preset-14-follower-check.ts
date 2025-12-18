/**
 * プリセットID 14「いいね3点セット#コスメオタクプロフ」に
 * プロフィールボタンを押してフォロワー数を確認するステップを追加
 */

import 'dotenv/config';
import { initDb, query, run } from '../src/drivers/db';
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
  
  // 既にフォロワー数確認ステップが追加されているか確認
  const hasFollowerCheck = steps.some((s: any) => 
    s.description && s.description.includes('フォロワー数')
  );
  
  if (hasFollowerCheck) {
    console.log(`\n✅ フォロワー数確認ステップは既に追加されています`);
    console.log('現在のステップ:');
    steps.forEach((s: any, i: number) => {
      console.log(`  [${i + 1}] ${s.type}: ${s.description || '(説明なし)'}`);
    });
    process.exit(0);
  }
  
  // フォロワー数確認ステップを追加
  // プロフィールボタンをクリックするステップ
  const profileClickStep = {
    type: 'click',
    description: 'プロフィールボタンをクリック',
    selector: 'a[data-testid="AppTabBar_Profile_Link"], a[href*="/"][aria-label*="プロフィール"], a[href*="/"][aria-label*="Profile"]',
    postWaitSeconds: 2
  };
  
  // フォロワー数を取得するステップ
  const followerCheckStep = {
    type: 'eval',
    description: 'フォロワー数を確認',
    code: `
      // フォロワー数のリンクを探す（複数のパターンを試す）
      let followerLink = document.querySelector('a[href*="/followers"]');
      if (!followerLink) {
        // 別のパターン: フォロワー数のテキストを含む要素を探す
        const allLinks = Array.from(document.querySelectorAll('a'));
        followerLink = allLinks.find(link => {
          const text = (link.textContent || link.innerText || '').toLowerCase();
          return text.includes('フォロワー') || text.includes('follower');
        });
      }
      
      if (followerLink) {
        const followerText = followerLink.textContent || followerLink.innerText || '';
        // フォロワー数を抽出（例: "1,234 フォロワー" → "1234"）
        const match = followerText.match(/([\\d,]+)/);
        if (match) {
          const followerCount = match[1].replace(/,/g, '');
          return { ok: true, followerCount: parseInt(followerCount, 10), rawText: followerText };
        }
      }
      
      // フォロワー数が見つからない場合、ページのテキストから探す
      const pageText = document.body.textContent || '';
      const textMatch = pageText.match(/([\\d,]+)\\s*(フォロワー|follower)/i);
      if (textMatch) {
        const followerCount = textMatch[1].replace(/,/g, '');
        return { ok: true, followerCount: parseInt(followerCount, 10), rawText: textMatch[0] };
      }
      
      return { ok: false, error: 'フォロワー数が見つかりませんでした' };
    `,
    postWaitSeconds: 1
  };
  
  // ステップを追加（いいね取得の前に追加）
  // いいね取得ステップの前に挿入するため、適切な位置を探す
  let insertIndex = steps.length;
  
  // 「いいね」関連のステップの前を探す
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.description && (step.description.includes('いいね') || step.description.includes('like'))) {
      insertIndex = i;
      break;
    }
  }
  
  // ステップを挿入
  const updatedSteps = [
    ...steps.slice(0, insertIndex),
    profileClickStep,
    followerCheckStep,
    ...steps.slice(insertIndex)
  ];
  
  try {
    updatePreset(preset.id, preset.name, preset.description || '', JSON.stringify(updatedSteps));
    console.log(`\n✅ プリセットを更新しました:`);
    console.log(`   ID: ${preset.id}`);
    console.log(`   ステップ数: ${steps.length} → ${updatedSteps.length}`);
    console.log(`\n追加されたステップ:`);
    console.log(`   - ステップ${insertIndex + 1}: プロフィールボタンをクリック`);
    console.log(`   - ステップ${insertIndex + 2}: フォロワー数を確認`);
    console.log(`\n更新後のステップ一覧:`);
    updatedSteps.forEach((s: any, i: number) => {
      const marker = (i === insertIndex || i === insertIndex + 1) ? ' ← 追加' : '';
      console.log(`  [${i + 1}] ${s.type}: ${s.description || '(説明なし)'}${marker}`);
    });
  } catch (e: any) {
    console.error('❌ プリセット更新に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

