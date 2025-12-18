#!/usr/bin/env tsx
/**
 * プリセット18のステップ2を修正
 * 日本語のaria-label「バナー画像を追加」に対応
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

// ステップ2（index 1）を修正
if (steps[1] && steps[1].type === 'eval' && steps[1].name === 'ヘッダ画像input要素を特定') {
  console.log('ステップ2を修正します...\n');
  
  // 日本語のaria-labelに対応したセレクタを追加
  const newCode = `(async () => {
  try {
    const bannerImagePath = "{{banner_image_path}}";
    // 未指定の場合はスキップ
    if (!bannerImagePath || bannerImagePath.trim() === '') {
      return { didAction: true, skipped: true, reason: 'banner_image_path not provided, skipping' };
    }
    
    // ページの読み込みを待つ
    let waitCount = 0;
    while (waitCount < 20) {
      if (document.readyState === 'complete') {
        await new Promise(r => setTimeout(r, 500)); // 追加の500ms待機
        break;
      }
      await new Promise(r => setTimeout(r, 200));
      waitCount++;
    }
    
    // 複数のセレクターを試行（日本語版も含む）
    let bannerBtn = null;
    const selectors = [
      'button[aria-label="Add banner photo"]',
      'button[aria-label="バナー画像を追加"]',
      'button[aria-label*="banner"]',
      'button[aria-label*="Banner"]',
      'button[aria-label*="バナー"]',
      'button[data-testid*="banner"]',
      '[role="button"][aria-label*="banner"]',
      '[role="button"][aria-label*="バナー"]'
    ];
    
    for (const sel of selectors) {
      bannerBtn = document.querySelector(sel);
      if (bannerBtn) break;
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
    const maxDepth = 5;
    
    while (parent && searchDepth < maxDepth) {
      fileInput = parent.querySelector('input[type="file"][data-testid="fileInput"]');
      if (fileInput) break;
      parent = parent.parentElement;
      searchDepth++;
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
  
  console.log('ステップ2を修正しました:');
  console.log('  - 日本語のaria-label「バナー画像を追加」に対応');
  console.log('  - aria-label*="バナー" のパターンマッチも追加');
  
  // データベースを更新
  const updatedStepsJson = JSON.stringify(steps, null, 2);
  run(
    'UPDATE presets SET steps_json = ?, updated_at = ? WHERE id = ?',
    [updatedStepsJson, Date.now(), preset.id]
  );
  
  console.log('\n✓ プリセット18を更新しました');
} else {
  console.error('ステップ2が見つからないか、期待する形式ではありません');
  console.log('現在のステップ2:', JSON.stringify(steps[1], null, 2));
  process.exit(1);
}


