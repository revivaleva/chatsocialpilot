#!/usr/bin/env tsx
/**
 * プリセット18のステップ4（プロフィール画像input要素を特定）を改善
 * - avatar_image_pathのチェックを追加（未指定時はスキップ）
 * - ページ読み込み待機を追加
 * - 複数のセレクターを試行
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
console.log(`現在のステップ数: ${steps.length}`);

// ステップ4（index 4）を改善 - プロフィール画像input要素を特定
if (steps[4] && steps[4].type === 'eval' && steps[4].name === 'プロフィール画像input要素を特定') {
  const newCode = `(async () => {
  try {
    const avatarImagePath = "{{avatar_image_path}}";
    // 未指定の場合はスキップ
    if (!avatarImagePath || avatarImagePath.trim() === '') {
      return { didAction: true, skipped: true, reason: 'avatar_image_path not provided, skipping' };
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
    
    // 複数のセレクターを試行
    let avatarBtn = null;
    const selectors = [
      'button[aria-label="Add avatar photo"]',
      'button[aria-label*="avatar"]',
      'button[aria-label*="Avatar"]',
      'button[data-testid*="avatar"]',
      '[role="button"][aria-label*="avatar"]'
    ];
    
    for (const sel of selectors) {
      avatarBtn = document.querySelector(sel);
      if (avatarBtn) break;
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
    const maxDepth = 5;
    
    while (parent && searchDepth < maxDepth) {
      fileInput = parent.querySelector('input[type="file"][data-testid="fileInput"]');
      if (fileInput) break;
      parent = parent.parentElement;
      searchDepth++;
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

  steps[4].code = newCode;
  
  console.log('\nステップ4を改善しました:');
  console.log('  - avatar_image_pathのチェックを追加（未指定時はスキップ）');
  console.log('  - ページ読み込み待機を追加');
  console.log('  - 複数のセレクターを試行');
  console.log('  - ボタンが見つからない場合はスキップして続行（既に設定されている可能性）');
  
  // データベースを更新
  const updatedStepsJson = JSON.stringify(steps, null, 2);
  run(
    'UPDATE presets SET steps_json = ?, updated_at = ? WHERE id = ?',
    [updatedStepsJson, Date.now(), preset.id]
  );
  
  console.log('\n✓ プリセット18を更新しました');
} else {
  console.error('ステップ4が見つからないか、期待する形式ではありません');
  console.log('現在のステップ4:', JSON.stringify(steps[4], null, 2));
  process.exit(1);
}
