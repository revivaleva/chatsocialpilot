#!/usr/bin/env tsx
/**
 * プリセット18のステップ2とステップ3の間に、
 * data-banner-input要素の存在確認ステップを追加
 * 要素が見つからない場合はステップ3をスキップ
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

// ステップ3（setFileInput）の前にチェックステップを挿入
// 現在のステップ3（index 2）が setFileInput か確認
if (steps[2] && steps[2].type === 'setFileInput' && steps[2].name === 'ヘッダ画像を設定') {
  console.log('ステップ2と3の間にチェックステップを追加します...\n');
  
  // ステップ2と3の間に、data-banner-input要素の存在確認ステップを挿入
  const checkStep = {
    type: 'eval',
    name: 'ヘッダ画像input要素の存在確認',
    description: 'data-banner-input属性が付与されたinput要素が存在するか確認',
    code: `(async () => {
  try {
    const bannerImagePath = "{{banner_image_path}}";
    // banner_image_pathが未指定の場合はスキップ
    if (!bannerImagePath || bannerImagePath.trim() === '') {
      return { didAction: true, skipped: true, reason: 'banner_image_path not provided, skipping' };
    }
    
    // data-banner-input属性が付与されたinput要素を探す
    const bannerInput = document.querySelector('input[type="file"][data-testid="fileInput"][data-banner-input="true"]');
    
    if (!bannerInput) {
      // 要素が見つからない場合はスキップ（前のステップでボタンが見つからなかった可能性）
      return { didAction: true, skipped: true, reason: 'banner input element with data-banner-input not found, previous step may have been skipped' };
    }
    
    return { didAction: true, reason: 'banner input element found' };
  } catch (e) {
    return { didAction: false, reason: String(e) };
  }
})()`,
    postWaitSeconds: 0.5,
    options: {
      timeoutMs: 5000
    }
  };
  
  // ステップ2と3の間に挿入（index 2の位置に挿入すると、元のステップ3はindex 3になる）
  steps.splice(2, 0, checkStep);
  
  console.log('チェックステップを追加しました（新しいステップ3）:');
  console.log('  - data-banner-input要素の存在確認');
  console.log('  - 要素が見つからない場合はスキップ');
  console.log('  - 元のステップ3（setFileInput）は新しいステップ4になります');
  
  // データベースを更新
  const updatedStepsJson = JSON.stringify(steps, null, 2);
  run(
    'UPDATE presets SET steps_json = ?, updated_at = ? WHERE id = ?',
    [updatedStepsJson, Date.now(), preset.id]
  );
  
  console.log('\n✓ プリセット18を更新しました');
  console.log(`  新しいステップ数: ${steps.length}`);
} else {
  console.error('ステップ3が見つからないか、期待する形式ではありません');
  console.log('現在のステップ3:', JSON.stringify(steps[2], null, 2));
  process.exit(1);
}


