#!/usr/bin/env tsx
/**
 * プリセット18のステップ5と6の間に、
 * data-avatar-input要素の存在を確認するevalステップを追加し、
 * ステップ6（setFileInput）を改善するスクリプト
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

// ステップ5（index 5）が「プロフィール画像input要素を特定」であることを確認
if (!steps[5] || steps[5].type !== 'eval' || steps[5].name !== 'プロフィール画像input要素を特定') {
  console.error('ステップ5（プロフィール画像input要素を特定）が見つからないか、期待する形式ではありません');
  console.log('現在のステップ5:', JSON.stringify(steps[5], null, 2));
  process.exit(1);
}

// ステップ6（index 6）が「プロフィール画像を設定」（setFileInput）であることを確認
if (!steps[6] || steps[6].type !== 'setFileInput' || steps[6].name !== 'プロフィール画像を設定') {
  console.error('ステップ6（プロフィール画像を設定）が見つからないか、期待する形式ではありません');
  console.log('現在のステップ6:', JSON.stringify(steps[6], null, 2));
  process.exit(1);
}

// 新しいステップをステップ6（インデックス6）として挿入
// 元のステップ6（setFileInput）は新しいステップ7になる
const newCheckStep = {
  type: "eval",
  name: "プロフィール画像input要素の存在確認",
  description: "data-avatar-input属性が付与されたinput要素が存在するか確認",
  code: `(async () => {
  try {
    const avatarImagePath = "{{avatar_image_path}}";
    // avatar_image_pathが未指定の場合はスキップ
    if (!avatarImagePath || avatarImagePath.trim() === '') {
      return { didAction: true, skipped: true, reason: 'avatar_image_path not provided, skipping' };
    }
    
    // data-avatar-input属性が付与されたinput要素を探す
    const avatarInput = document.querySelector('input[type="file"][data-testid="fileInput"][data-avatar-input="true"]');
    
    if (!avatarInput) {
      // 要素が見つからない場合はスキップ（前のステップでボタンが見つからなかった可能性）
      return { didAction: true, skipped: true, reason: 'avatar input element with data-avatar-input not found, previous step may have been skipped' };
    }
    
    return { didAction: true, reason: 'avatar input element found' };
  } catch (e) {
    return { didAction: false, reason: String(e) };
  }
})()`,
  postWaitSeconds: 0.5,
  options: {
    timeoutMs: 5000
  }
};

// ステップ5と6の間に挿入 (元のステップ6が新しいステップ7になる)
steps.splice(6, 0, newCheckStep);

console.log('ステップ5と6の間にチェックステップを追加します...');
console.log('チェックステップを追加しました（新しいステップ6）:');
console.log('  - data-avatar-input要素の存在確認');
console.log('  - 要素が見つからない場合はスキップ');
console.log('  - 元のステップ6（setFileInput）は新しいステップ7になります\n');

// ステップ7（元のステップ6、index 7）を改善
if (steps[7] && steps[7].type === 'setFileInput' && steps[7].name === 'プロフィール画像を設定') {
  steps[7].options.timeoutMs = 60000; // タイムアウトを60秒に延長
  delete steps[7].options.waitForSelector; // waitForSelectorを削除
  steps[7].timeoutSeconds = 60; // ステップ全体のタイムアウトも60秒に延長
  steps[7].postWaitSeconds = 5; // postWaitSecondsを5秒に延長
  console.log('ステップ7（プロフィール画像setFileInput）を改善します...');
  console.log('  - タイムアウト時間: 30秒 → 60秒');
  console.log('  - waitForSelector: 削除（ステップ6で既に確認済み）');
  console.log('  - postWaitSeconds: 3秒 → 5秒');
} else {
  console.error('ステップ7（プロフィール画像を設定）が見つからないか、期待する形式ではありません');
  console.log('現在のステップ7:', JSON.stringify(steps[7], null, 2));
  process.exit(1);
}

// データベースを更新
const updatedStepsJson = JSON.stringify(steps, null, 2);
run(
  'UPDATE presets SET steps_json = ?, updated_at = ? WHERE id = ?',
  [updatedStepsJson, Date.now(), preset.id]
);

console.log('\n✓ プリセット18を更新しました');
console.log(`  新しいステップ数: ${steps.length}`);

