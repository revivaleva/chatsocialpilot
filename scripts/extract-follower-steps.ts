import { initDb, query } from '../src/drivers/db';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  initDb({ wal: true });

// 「いいね3点セット」プリセットを取得
const presets = query('SELECT id, name, steps_json FROM presets WHERE name LIKE ?', ['%いいね3点セット%']);

if (presets.length === 0) {
  console.log('「いいね3点セット」プリセットが見つかりませんでした');
  process.exit(1);
}

// 最初のプリセットを使用
const preset = presets[0] as any;
console.log('プリセットID:', preset.id);
console.log('プリセット名:', preset.name);
console.log('');

const steps = JSON.parse(preset.steps_json || '[]');
console.log('全ステップ数:', steps.length);
console.log('');

// フォロワー数取得・保存に関連するステップを特定
const followerSteps: any[] = [];
let containerStep: any = null;

steps.forEach((step: any, index: number) => {
  // containerステップを探す
  if (step.type === 'container' || step.type === 'open_container') {
    console.log(`ステップ${index}: containerステップ`);
    if (!containerStep) {
      containerStep = step;
    }
  }
  
  // プロフィールページへのナビゲーションステップを探す
  if (step.type === 'navigate' && step.url && (step.url.includes('{{db_container_name}}') || step.url.includes('x.com'))) {
    console.log(`ステップ${index}: プロフィールページへのナビゲーション`);
    followerSteps.push({ index, step, isNavigate: true });
  }
  
  // フォロワー関連のevalステップを探す（取得）
  if (step.type === 'eval' && step.code) {
    const code = step.code.toLowerCase();
    if (code.includes('follower') || code.includes('フォロワー') || code.includes('follower_count') || code.includes('following_count')) {
      console.log(`ステップ${index}: フォロワー数取得ステップ`);
      console.log(`  名前: ${step.name || 'N/A'}`);
      console.log(`  コードの一部: ${step.code.substring(0, 200)}...`);
      followerSteps.push({ index, step, isEval: true });
    }
  }
  
  // save_follower_countステップを探す（保存）
  if (step.type === 'save_follower_count') {
    console.log(`ステップ${index}: フォロワー数保存ステップ`);
    console.log(`  説明: ${step.description || 'N/A'}`);
    followerSteps.push({ index, step, isSave: true });
  }
});

console.log('\n=== 抽出されたフォロワー関連ステップ ===');
console.log('件数:', followerSteps.length);

// フォロワー数取得・保存のみのプリセットを作成
if (followerSteps.length > 0) {
  const newSteps: any[] = [];
  
  // containerステップがあれば最初に追加（元のプリセットの最初のステップを確認）
  if (!containerStep && steps.length > 0 && (steps[0].type === 'container' || steps[0].type === 'open_container')) {
    containerStep = steps[0];
  }
  
  if (containerStep) {
    newSteps.push(containerStep);
  }
  
  // ステップを順序通りに追加（navigate → eval → save_follower_count）
  // 1. プロフィールページへのナビゲーション
  const navigateStep = followerSteps.find(({ isNavigate }) => isNavigate);
  if (navigateStep) {
    newSteps.push(navigateStep.step);
  }
  
  // 2. フォロワー数取得（eval）
  const evalStep = followerSteps.find(({ isEval }) => isEval);
  if (evalStep) {
    newSteps.push(evalStep.step);
  }
  
  // 3. フォロワー数保存（save_follower_count）
  const saveStep = followerSteps.find(({ isSave }) => isSave);
  if (saveStep) {
    newSteps.push(saveStep.step);
  }
  
  console.log('\n新しいプリセットのステップ構成:');
  newSteps.forEach((s, i) => {
    console.log(`  ${i}: type=${s.type}, name=${s.name || 'N/A'}`);
  });
  
  // JSONとして出力
  const newPreset = {
    name: 'フォロワー数取得・保存',
    description: 'いいね3点セットからフォロワー数取得・保存の実装を抜き出したプリセット',
    steps: newSteps
  };
  
  console.log('\n=== 新しいプリセットJSON ===');
  console.log(JSON.stringify(newPreset, null, 2));
  
  // ファイルに保存
  const outputPath = path.resolve('presets', 'follower-count-only.json');
  fs.writeFileSync(outputPath, JSON.stringify(newPreset, null, 2), 'utf8');
  console.log(`\nプリセットを保存しました: ${outputPath}`);
  
  // データベースにも登録
  const { createPreset } = await import('../src/services/presets');
  const result = createPreset(newPreset.name, newPreset.description, JSON.stringify(newPreset.steps));
  console.log(`データベースに登録しました: プリセットID ${result.id}`);
} else {
  console.log('フォロワー関連ステップが見つかりませんでした');
}
}

main().catch((e) => {
  console.error('エラー:', e);
  process.exit(1);
});

