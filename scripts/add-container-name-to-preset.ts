/**
 * X Authログインプリセット（ID: 16）にコンテナ名パラメータを追加するスクリプト
 * 
 * 使用方法:
 *   npx tsx scripts/add-container-name-to-preset.ts
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset } from '../src/services/presets';

async function main() {
  // DBを初期化
  initDb({ wal: true });
  
  const presetId = 16;
  const preset = getPreset(presetId);
  
  if (!preset) {
    console.error(`❌ プリセット ID ${presetId} が見つかりません`);
    process.exit(1);
  }
  
  console.log(`現在のプリセット情報:`);
  console.log(`  ID: ${preset.id}`);
  console.log(`  名前: ${preset.name}`);
  
  // ステップを取得
  const steps = JSON.parse(preset.steps_json || '[]');
  console.log(`  現在のステップ数: ${steps.length}`);
  
  // 最初のステップがコンテナ名取得ステップかどうか確認
  const hasContainerNameStep = steps.length > 0 && 
    steps[0].type === 'eval' && 
    steps[0].code && 
    steps[0].code.includes('{{container_name}}');
  
  if (hasContainerNameStep) {
    console.log(`\n✅ コンテナ名パラメータは既に追加されています`);
    process.exit(0);
  }
  
  // コンテナ名取得ステップを先頭に追加
  // 注意: このステップはパラメータ検出のためだけに存在し、実際のブラウザ操作は行いません
  // デバッグモードでは、このステップを実行してもコンテナが開かれることはありません
  const containerNameStep = {
    type: 'eval',
    description: 'コンテナ名を取得（パラメータ検出用、ブラウザ操作なし）',
    code: `
      (async () => {
        // コンテナ名: {{container_name}}
        // 注意: コンテナ作成は taskQueue.ts で自動的に行われるため、ここでは参照のみ
        // このステップはパラメータ検出のためだけに存在し、実際のブラウザ操作は行いません
        const containerName = '{{container_name}}';
        // ブラウザ操作を一切行わず、即座に成功を返す
        return { 
          didAction: true, 
          reason: 'コンテナ名を取得しました（パラメータ検出用、ブラウザ操作なし）',
          containerName: containerName,
          skipBrowserOperation: true
        };
      })()
    `,
    postWaitSeconds: 0,
    // デバッグモードでこのステップをスキップ可能にするためのフラグ（オプション）
    skipInDebug: false
  };
  
  const updatedSteps = [containerNameStep, ...steps];
  
  try {
    updatePreset(presetId, preset.name, preset.description, JSON.stringify(updatedSteps));
    console.log(`\n✅ プリセットを更新しました:`);
    console.log(`   ID: ${presetId}`);
    console.log(`   ステップ数: ${updatedSteps.length}（コンテナ名取得ステップを追加）`);
    console.log(`\n追加されたステップ:`);
    console.log(`   - ステップ1: コンテナ名を取得（パラメータ検出用）`);
    console.log(`\nこれで、デバッグモードで container_name のパラメータ入力欄が表示されます`);
  } catch (e: any) {
    console.error('❌ プリセット更新に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

