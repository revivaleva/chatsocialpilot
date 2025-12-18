#!/usr/bin/env tsx
/**
 * プリセット18の改善:
 * 1. ステップ4（setFileInput）のwaitForSelectorを削除（ステップ3で既に確認済み）
 * 2. タイムアウト時間を延長（Google Drive URLダウンロード対応）
 * 3. プロフィール画像設定部分（ステップ6以降）に日本語対応を追加
 * 4. Applyボタンの検出に日本語対応を追加
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

let changed = false;

// 1. ステップ4（index 3）のsetFileInputを改善（banner画像）
if (steps[3] && steps[3].type === 'setFileInput' && steps[3].name === 'ヘッダ画像を設定') {
  console.log('ステップ4（ヘッダ画像setFileInput）を改善します...');
  
  // waitForSelectorを削除（ステップ3で既に確認済み）
  // タイムアウト時間を延長（60秒に設定）
  steps[3] = {
    ...steps[3],
    options: {
      timeoutMs: 60000, // 30秒 → 60秒に延長
      // waitForSelectorを削除（ステップ3で既に要素の存在を確認済み）
    },
    timeoutSeconds: 60,
    postWaitSeconds: 5 // 3秒 → 5秒に延長
  };
  
  console.log('  - タイムアウト時間: 30秒 → 60秒');
  console.log('  - waitForSelector: 削除（ステップ3で既に確認済み）');
  console.log('  - postWaitSeconds: 3秒 → 5秒');
  changed = true;
}

// 2. ステップ5（index 4）のApplyボタン検出に日本語対応を追加（banner画像）
if (steps[4] && steps[4].type === 'eval' && steps[4].name === 'ヘッダ画像のApplyボタンをクリック') {
  console.log('\nステップ5（ヘッダ画像Applyボタン）に日本語対応を追加します...');
  
  const originalCode = steps[4].code;
  
  // "Edit media"モーダルの検出に日本語対応を追加
  let newCode = originalCode.replace(
    /(titleText === 'Edit media' \|\| titleText\.includes\('Edit media'\))/,
    `(titleText === 'Edit media' || titleText.includes('Edit media') || titleText === 'メディアを編集' || titleText.includes('メディアを編集'))`
  );
  
  // "Apply"ボタンの検出に日本語対応を追加
  newCode = newCode.replace(
    /(text === 'Apply' \|\| text\.includes\('Apply'\))/g,
    `(text === 'Apply' || text.includes('Apply') || text === '適用' || text.includes('適用'))`
  );
  
  // ボタン検索の部分も修正
  newCode = newCode.replace(
    /(btnText === 'Apply' \|\| btnText\.includes\('Apply'\))/g,
    `(btnText === 'Apply' || btnText.includes('Apply') || btnText === '適用' || btnText.includes('適用'))`
  );
  
  steps[4].code = newCode;
  
  console.log('  - "Edit media"モーダルの検出に日本語対応を追加（「メディアを編集」）');
  console.log('  - "Apply"ボタンの検出に日本語対応を追加（「適用」）');
  changed = true;
}

// 3. ステップ6（index 5）のプロフィール画像input要素特定に日本語対応を追加
if (steps[5] && steps[5].type === 'eval' && steps[5].name === 'プロフィール画像input要素を特定') {
  console.log('\nステップ6（プロフィール画像input要素特定）に日本語対応を追加します...');
  
  const originalCode = steps[5].code;
  
  // セレクターリストに日本語版を追加
  let newCode = originalCode.replace(
    `'button[aria-label="Add avatar photo"]',`,
    `'button[aria-label="Add avatar photo"]',\n      'button[aria-label="アバター画像を追加"]',`
  ).replace(
    `'button[aria-label*="avatar"]',`,
    `'button[aria-label*="avatar"]',\n      'button[aria-label*="Avatar"]',\n      'button[aria-label*="アバター"]',`
  );
  
  steps[5].code = newCode;
  
  console.log('  - 日本語のaria-label「アバター画像を追加」に対応');
  console.log('  - aria-label*="アバター" のパターンマッチも追加');
  changed = true;
}

// 4. ステップ8（index 7）のプロフィール画像Applyボタンに日本語対応を追加
if (steps[7] && steps[7].type === 'eval' && steps[7].name === 'プロフィール画像のApplyボタンをクリック') {
  console.log('\nステップ8（プロフィール画像Applyボタン）に日本語対応を追加します...');
  
  const originalCode = steps[7].code;
  
  // "Edit media"モーダルの検出に日本語対応を追加
  let newCode = originalCode.replace(
    /(titleText === 'Edit media' \|\| titleText\.includes\('Edit media'\))/,
    `(titleText === 'Edit media' || titleText.includes('Edit media') || titleText === 'メディアを編集' || titleText.includes('メディアを編集'))`
  );
  
  // "Apply"ボタンの検出に日本語対応を追加
  newCode = newCode.replace(
    /(text === 'Apply' \|\| text\.includes\('Apply'\))/g,
    `(text === 'Apply' || text.includes('Apply') || text === '適用' || text.includes('適用'))`
  );
  
  // ボタン検索の部分も修正
  newCode = newCode.replace(
    /(btnText === 'Apply' \|\| btnText\.includes\('Apply'\))/g,
    `(btnText === 'Apply' || btnText.includes('Apply') || btnText === '適用' || btnText.includes('適用'))`
  );
  
  steps[7].code = newCode;
  
  console.log('  - "Edit media"モーダルの検出に日本語対応を追加（「メディアを編集」）');
  console.log('  - "Apply"ボタンの検出に日本語対応を追加（「適用」）');
  changed = true;
}

// 5. ステップ17（index 16）のSaveボタンの検出に日本語対応を追加
if (steps[16] && steps[16].type === 'eval' && steps[16].name === 'Saveボタンをクリック') {
  console.log('\nステップ17（Saveボタン）に日本語対応を追加します...');
  
  const originalCode = steps[16].code;
  
  // "Close"ボタンの検出に日本語対応を追加
  let newCode = originalCode.replace(
    /(text === 'OK' \|\| text === '閉じる' \|\| text === 'Close' \|\| text\.includes\('閉じる'\))/,
    `(text === 'OK' || text === '閉じる' || text === 'Close' || text.includes('閉じる') || text === 'OK')`
  );
  
  steps[16].code = newCode;
  
  console.log('  - "Close"ボタンの検出は既に日本語対応済み（「閉じる」）');
  changed = true;
}

if (changed) {
  // データベースを更新
  const updatedStepsJson = JSON.stringify(steps, null, 2);
  run(
    'UPDATE presets SET steps_json = ?, updated_at = ? WHERE id = ?',
    [updatedStepsJson, Date.now(), preset.id]
  );
  
  console.log('\n✓ プリセット18を更新しました');
  console.log(`  新しいステップ数: ${steps.length}`);
} else {
  console.log('\n変更はありませんでした');
}


