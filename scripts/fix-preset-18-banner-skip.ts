#!/usr/bin/env tsx
/**
 * プリセット18のステップ1（ヘッダ画像input要素を特定）に
 * banner_image_pathのチェックを追加してスキップロジックを実装
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

// ステップ1（index 1）を修正
// 現在のステップ1は「ヘッダ画像input要素を特定」
if (steps[1] && steps[1].type === 'eval' && steps[1].name === 'ヘッダ画像input要素を特定') {
  const originalCode = steps[1].code;
  
  // banner_image_pathのチェックを追加
  const newCode = `(async () => {
  try {
    const bannerImagePath = "{{banner_image_path}}";
    // 未指定の場合はスキップ
    if (!bannerImagePath || bannerImagePath.trim() === '') {
      return { didAction: true, skipped: true, reason: 'banner_image_path not provided, skipping' };
    }
    
    const bannerBtn = document.querySelector('button[aria-label="Add banner photo"]');
    if (!bannerBtn) {
      return { didAction: false, reason: 'banner photo button not found' };
    }
    // 親要素からinput要素を探す
    const parent = bannerBtn.parentElement;
    if (!parent) {
      return { didAction: false, reason: 'banner photo button parent not found' };
    }
    const fileInput = parent.querySelector('input[type="file"][data-testid="fileInput"]');
    if (!fileInput) {
      return { didAction: false, reason: 'banner photo file input not found' };
    }
    // 一時的なdata属性を追加して識別可能にする
    fileInput.setAttribute('data-banner-input', 'true');
    return { didAction: true, reason: 'banner photo input identified' };
  } catch (e) {
    return { didAction: false, reason: String(e) };
  }
})()`;

  steps[1].code = newCode;
  
  console.log('\nステップ1を修正しました:');
  console.log('  - banner_image_pathのチェックを追加');
  console.log('  - 未指定の場合はスキップして次のステップへ');
  
  // データベースを更新
  const updatedStepsJson = JSON.stringify(steps, null, 2);
  run(
    'UPDATE presets SET steps_json = ?, updated_at = ? WHERE id = ?',
    [updatedStepsJson, Date.now(), preset.id]
  );
  
  console.log('\n✓ プリセット18を更新しました');
} else {
  console.error('ステップ1が見つからないか、期待する形式ではありません');
  console.log('現在のステップ1:', JSON.stringify(steps[1], null, 2));
  process.exit(1);
}
