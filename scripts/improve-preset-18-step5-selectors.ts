#!/usr/bin/env tsx
/**
 * プリセット18のステップ5（プロフィール画像input要素を特定）のセレクターを改善するスクリプト
 * - より多くのセレクターパターンを追加
 * - テキストコンテンツベースの検索を追加
 * - 画像要素をクリックしてモーダルを開く方法も試行
 */

import { initDb, query, run } from '../src/drivers/db.js';

initDb();

const preset = query<{ id: number; name: string; steps_json: string }>(
  'SELECT id, name, steps_json FROM presets WHERE id = 18'
)[0];

if (!preset) {
  console.error('プリセット18が見つかりません');
  process.exit(1);
}

const steps = JSON.parse(preset.steps_json);

console.log(`プリセット${preset.id}: ${preset.name}`);
console.log(`現在のステップ数: ${steps.length}\n`);

// ステップ5（index 5）を修正: プロフィール画像input要素を特定
if (steps[5] && steps[5].type === 'eval' && steps[5].name === 'プロフィール画像input要素を特定') {
  console.log('ステップ5（プロフィール画像input要素を特定）を改善します...');
  
  const newCode = `(async () => {
  try {
    const avatarImagePath = "{{avatar_image_path}}";
    // 未指定の場合はスキップ
    if (!avatarImagePath || avatarImagePath.trim() === '') {
      return { didAction: true, skipped: true, reason: 'avatar_image_path not provided, skipping' };
    }

    // ページの読み込みを待つ
    let waitCount = 0;
    while (waitCount < 30) {
      if (document.readyState === 'complete') {
        await new Promise(r => setTimeout(r, 1000)); // 追加の1秒待機（モーダルやダイナミックコンテンツの読み込みを待つ）
        break;
      }
      await new Promise(r => setTimeout(r, 200));
      waitCount++;
    }

    // 複数のセレクターを試行（ボタン、リンク、画像など）
    let avatarBtn = null;
    const selectors = [
      // 英語のaria-label
      'button[aria-label="Add avatar photo"]',
      'button[aria-label="Change avatar photo"]',
      'button[aria-label="Edit avatar photo"]',
      'button[aria-label="Update avatar photo"]',
      'button[aria-label*="avatar"]',
      'button[aria-label*="Avatar"]',
      // 日本語のaria-label
      'button[aria-label="アバター画像を追加"]',
      'button[aria-label="アバター画像を変更"]',
      'button[aria-label="プロフィール画像を変更"]',
      'button[aria-label="写真を変更"]',
      'button[aria-label*="アバター"]',
      'button[aria-label*="プロフィール画像"]',
      'button[aria-label*="写真"]',
      // data-testid
      'button[data-testid*="avatar"]',
      'button[data-testid*="Avatar"]',
      'button[data-testid*="profile"]',
      'button[data-testid*="Profile"]',
      // role属性
      '[role="button"][aria-label*="avatar"]',
      '[role="button"][aria-label*="Avatar"]',
      '[role="button"][aria-label*="アバター"]',
      '[role="button"][aria-label*="プロフィール画像"]',
      // その他のパターン
      'a[aria-label*="avatar"]',
      'a[aria-label*="アバター"]',
      'div[role="button"][aria-label*="avatar"]',
      'div[role="button"][aria-label*="アバター"]'
    ];

    for (const sel of selectors) {
      try {
        avatarBtn = document.querySelector(sel);
        if (avatarBtn) {
          console.log('Found button with selector:', sel);
          break;
        }
      } catch (e) {
        // セレクターエラーは無視して続行
      }
    }

    // セレクターで見つからない場合、テキストコンテンツベースで検索
    if (!avatarBtn) {
      const allButtons = document.querySelectorAll('button, [role="button"], a[href*="#"]');
      for (const btn of allButtons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
        const combined = text + ' ' + ariaLabel;
        
        // 英語のキーワード
        if (combined.includes('avatar') || combined.includes('profile picture') || combined.includes('change photo')) {
          avatarBtn = btn;
          console.log('Found button by text content (English)');
          break;
        }
        
        // 日本語のキーワード
        if (combined.includes('アバター') || combined.includes('プロフィール画像') || combined.includes('写真') || combined.includes('変更') || combined.includes('追加')) {
          avatarBtn = btn;
          console.log('Found button by text content (Japanese)');
          break;
        }
      }
    }

    // それでも見つからない場合、画像要素をクリックしてモーダルを開く方法を試行
    if (!avatarBtn) {
      // プロフィール画像のコンテナを探す
      const profileImageContainer = document.querySelector('[data-testid="profile-image-container"], [class*="profile"], [class*="avatar"]');
      if (profileImageContainer) {
        // コンテナ内の画像要素またはクリック可能な要素を探す
        const clickableInContainer = profileImageContainer.querySelector('img, button, [role="button"], a');
        if (clickableInContainer) {
          avatarBtn = clickableInContainer;
          console.log('Found clickable element in profile image container');
        }
      }
    }

    if (!avatarBtn) {
      // ボタンが見つからない場合、プロフィール画像が既に設定されている可能性がある
      // この場合はスキップして続行
      return { didAction: true, skipped: true, reason: 'avatar photo button not found, may already be set' };
    }

    // 親要素からinput要素を探す
    let parent = avatarBtn.parentElement;
    let fileInput = null;
    let searchDepth = 0;
    const maxDepth = 10; // 検索深度を増やす

    while (parent && searchDepth < maxDepth) {
      fileInput = parent.querySelector('input[type="file"][data-testid="fileInput"]');
      if (fileInput) break;
      parent = parent.parentElement;
      searchDepth++;
    }

    // 親要素で見つからない場合、document全体から検索
    if (!fileInput) {
      fileInput = document.querySelector('input[type="file"][data-testid="fileInput"]');
      // 複数のfile inputがある場合は、プロフィール画像用のものを特定
      if (fileInput) {
        const allFileInputs = document.querySelectorAll('input[type="file"][data-testid="fileInput"]');
        // 最初のfile inputを使用（通常、プロフィール画像が先）
        fileInput = allFileInputs[0];
      }
    }

    if (!fileInput) {
      // input要素が見つからない場合もスキップ
      return { didAction: true, skipped: true, reason: 'avatar photo file input not found, may already be set' };
    }

    // 一時的なdata属性を追加して識別可能にする
    fileInput.setAttribute('data-avatar-input', 'true');
    return { didAction: true, reason: 'avatar photo input identified' };
  } catch (e) {
    return { didAction: false, reason: String(e) };
  }
})()`;

  steps[5].code = newCode;

  console.log('改善内容:');
  console.log('  - セレクターを大幅に拡張（英語・日本語のaria-label、data-testid、role属性など）');
  console.log('  - テキストコンテンツベースの検索を追加（英語・日本語のキーワード）');
  console.log('  - プロフィール画像コンテナからクリック可能な要素を検索する方法を追加');
  console.log('  - ページ読み込み待機時間を延長（500ms → 1000ms）');
  console.log('  - input要素の検索深度を増加（5 → 10）');
  console.log('  - document全体からfile inputを検索するフォールバックを追加');
  console.log('  - より詳細なログ出力を追加');

  // データベースを更新
  const updatedStepsJson = JSON.stringify(steps, null, 2);
  run(
    'UPDATE presets SET steps_json = ?, updated_at = ? WHERE id = ?',
    [updatedStepsJson, Date.now(), preset.id]
  );

  console.log('\n✓ プリセット18を更新しました');
  console.log(`  新しいステップ数: ${steps.length}`);
} else {
  console.error('ステップ5（プロフィール画像input要素を特定）が見つからないか、期待する形式ではありません');
  console.log('現在のステップ5:', JSON.stringify(steps[5], null, 2));
  process.exit(1);
}

