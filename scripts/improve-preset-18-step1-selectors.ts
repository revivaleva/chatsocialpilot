#!/usr/bin/env tsx
/**
 * プリセット18のステップ1（ヘッダ画像input要素を特定）のセレクターを改善するスクリプト
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

// ステップ1（index 1）を修正: ヘッダ画像input要素を特定
if (steps[1] && steps[1].type === 'eval' && steps[1].name === 'ヘッダ画像input要素を特定') {
  console.log('ステップ1（ヘッダ画像input要素を特定）を改善します...');
  
  const newCode = `(async () => {
  try {
    const bannerImagePath = "{{banner_image_path}}";
    // 未指定の場合はスキップ
    if (!bannerImagePath || bannerImagePath.trim() === '') {
      return { didAction: true, skipped: true, reason: 'banner_image_path not provided, skipping' };
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
    let bannerBtn = null;
    const selectors = [
      // 英語のaria-label
      'button[aria-label="Add banner photo"]',
      'button[aria-label="Change banner photo"]',
      'button[aria-label="Edit banner photo"]',
      'button[aria-label="Update banner photo"]',
      'button[aria-label*="banner"]',
      'button[aria-label*="Banner"]',
      'button[aria-label*="header"]',
      'button[aria-label*="Header"]',
      // 日本語のaria-label
      'button[aria-label="バナー画像を追加"]',
      'button[aria-label="バナー画像を変更"]',
      'button[aria-label="ヘッダ画像を変更"]',
      'button[aria-label="ヘッダー画像を変更"]',
      'button[aria-label="写真を変更"]',
      'button[aria-label*="バナー"]',
      'button[aria-label*="ヘッダ"]',
      'button[aria-label*="ヘッダー"]',
      'button[aria-label*="写真"]',
      // data-testid
      'button[data-testid*="banner"]',
      'button[data-testid*="Banner"]',
      'button[data-testid*="header"]',
      'button[data-testid*="Header"]',
      // role属性
      '[role="button"][aria-label*="banner"]',
      '[role="button"][aria-label*="Banner"]',
      '[role="button"][aria-label*="header"]',
      '[role="button"][aria-label*="バナー"]',
      '[role="button"][aria-label*="ヘッダ"]',
      // その他のパターン
      'a[aria-label*="banner"]',
      'a[aria-label*="バナー"]',
      'div[role="button"][aria-label*="banner"]',
      'div[role="button"][aria-label*="バナー"]'
    ];

    for (const sel of selectors) {
      try {
        bannerBtn = document.querySelector(sel);
        if (bannerBtn) {
          console.log('Found button with selector:', sel);
          break;
        }
      } catch (e) {
        // セレクターエラーは無視して続行
      }
    }

    // セレクターで見つからない場合、テキストコンテンツベースで検索
    if (!bannerBtn) {
      const allButtons = document.querySelectorAll('button, [role="button"], a[href*="#"]');
      for (const btn of allButtons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
        const combined = text + ' ' + ariaLabel;
        
        // 英語のキーワード
        if (combined.includes('banner') || combined.includes('header') || combined.includes('cover photo') || combined.includes('change photo')) {
          bannerBtn = btn;
          console.log('Found button by text content (English)');
          break;
        }
        
        // 日本語のキーワード
        if (combined.includes('バナー') || combined.includes('ヘッダ') || combined.includes('ヘッダー') || combined.includes('写真') || combined.includes('変更') || combined.includes('追加')) {
          bannerBtn = btn;
          console.log('Found button by text content (Japanese)');
          break;
        }
      }
    }

    // それでも見つからない場合、ヘッダー画像のコンテナをクリックしてモーダルを開く方法を試行
    if (!bannerBtn) {
      // ヘッダー画像のコンテナを探す
      const headerImageContainer = document.querySelector('[data-testid="header-image-container"], [class*="header"], [class*="banner"], [class*="cover"]');
      if (headerImageContainer) {
        // コンテナ内の画像要素またはクリック可能な要素を探す
        const clickableInContainer = headerImageContainer.querySelector('img, button, [role="button"], a');
        if (clickableInContainer) {
          bannerBtn = clickableInContainer;
          console.log('Found clickable element in header image container');
        }
      }
    }

    if (!bannerBtn) {
      // ボタンが見つからない場合、ヘッダ画像が既に設定されている可能性がある
      // この場合はスキップして続行
      return { didAction: true, skipped: true, reason: 'banner photo button not found, may already be set' };
    }

    // 親要素からinput要素を探す
    let parent = bannerBtn.parentElement;
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
      // 複数のfile inputがある場合は、ヘッダー画像用のものを特定
      if (fileInput) {
        const allFileInputs = document.querySelectorAll('input[type="file"][data-testid="fileInput"]');
        // 最初のfile inputを使用（通常、ヘッダー画像が先、またはプロフィール画像が先の場合は2番目）
        // ここでは最初のものを使用（ステップ2で確認済みの場合は確実）
        fileInput = allFileInputs[0];
      }
    }

    if (!fileInput) {
      // input要素が見つからない場合もスキップ
      return { didAction: true, skipped: true, reason: 'banner photo file input not found, may already be set' };
    }

    // 一時的なdata属性を追加して識別可能にする
    fileInput.setAttribute('data-banner-input', 'true');
    return { didAction: true, reason: 'banner photo input identified' };
  } catch (e) {
    return { didAction: false, reason: String(e) };
  }
})()`;

  steps[1].code = newCode;

  console.log('改善内容:');
  console.log('  - セレクターを大幅に拡張（英語・日本語のaria-label、data-testid、role属性など）');
  console.log('  - テキストコンテンツベースの検索を追加（英語・日本語のキーワード）');
  console.log('  - ヘッダー画像コンテナからクリック可能な要素を検索する方法を追加');
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
  console.error('ステップ1（ヘッダ画像input要素を特定）が見つからないか、期待する形式ではありません');
  console.log('現在のステップ1:', JSON.stringify(steps[1], null, 2));
  process.exit(1);
}

