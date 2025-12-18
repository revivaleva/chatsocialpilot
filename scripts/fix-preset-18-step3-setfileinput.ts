#!/usr/bin/env tsx
/**
 * プリセット18のステップ3を修正
 * 現在のnavigateステップ（URLが空）をsetFileInputステップに変更
 * ヘッダ画像を設定するためにsetFileInputを使用
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

// ステップ3（index 2）を確認・修正
// 現在のステップ3は「ヘッダ画像を設定」（navigateタイプ、URLが空）
if (steps[2] && steps[2].type === 'navigate' && steps[2].name === 'ヘッダ画像を設定') {
  console.log('ステップ3を確認しました:');
  console.log(`  現在のタイプ: ${steps[2].type}`);
  console.log(`  現在のURL: "${steps[2].url || ''}"`);
  console.log('\nステップ3をsetFileInputに変更します...\n');
  
  // ステップ3をsetFileInputに変更（プロフィール画像のステップ6と同じ構造）
  steps[2] = {
    type: 'setFileInput',
    name: 'ヘッダ画像を設定',
    description: 'ヘッダ画像を設定（banner_image_pathが指定されている場合のみ実行）',
    selector: 'input[type="file"][data-testid="fileInput"][data-banner-input="true"]',
    fileUrl: '{{banner_image_path}}',
    fileName: 'banner.jpg',
    fileType: 'image/jpeg',
    options: {
      timeoutMs: 30000,
      waitForSelector: 'input[type="file"][data-testid="fileInput"][data-banner-input="true"]'
    },
    timeoutSeconds: 30,
    postWaitSeconds: 3
  };
  
  console.log('ステップ3を修正しました:');
  console.log('  - タイプ: navigate → setFileInput');
  console.log('  - selector: input[type="file"][data-testid="fileInput"][data-banner-input="true"]');
  console.log('  - fileUrl: {{banner_image_path}}');
  console.log('  - banner_image_pathが未指定の場合は自動的にスキップされます');
  
  // データベースを更新
  const updatedStepsJson = JSON.stringify(steps, null, 2);
  run(
    'UPDATE presets SET steps_json = ?, updated_at = ? WHERE id = ?',
    [updatedStepsJson, Date.now(), preset.id]
  );
  
  console.log('\n✓ プリセット18を更新しました');
} else {
  console.error('ステップ3が見つからないか、期待する形式ではありません');
  console.log('現在のステップ3:', JSON.stringify(steps[2], null, 2));
  process.exit(1);
}


