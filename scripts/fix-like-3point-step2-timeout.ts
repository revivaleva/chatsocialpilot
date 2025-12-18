import { initDb, query } from '../src/drivers/db';
import { updatePreset } from '../src/services/presets';

/**
 * いいね3点セットのステップ2（インデックス1）のタイムアウトを60秒に延長するスクリプト
 */

type PresetRow = {
  id: number;
  name: string;
  description: string;
  steps_json: string;
};

async function main() {
  initDb({ wal: true });

  console.log('=== いいね3点セットのステップ2タイムアウト修正 ===\n');

  // いいね3点セットのプリセットを取得
  const allPresets = query<PresetRow>(
    'SELECT id, name, description, steps_json FROM presets WHERE name LIKE ? ORDER BY id',
    ['%いいね3点セット%']
  );

  if (allPresets.length === 0) {
    console.log('いいね3点セットのpresetが見つかりませんでした。');
    return;
  }

  console.log(`対象プリセット数: ${allPresets.length}\n`);

  let updatedCount = 0;

  for (const preset of allPresets) {
    try {
      const steps = JSON.parse(preset.steps_json || '[]');
      if (!Array.isArray(steps)) {
        console.log(`[${preset.id}] ${preset.name}: steps_jsonが配列ではありません`);
        continue;
      }

      // ステップ2（インデックス1）を確認
      if (steps.length < 2) {
        console.log(`[${preset.id}] ${preset.name}: ステップが2つ未満です`);
        continue;
      }

      const step2 = steps[1]; // インデックス1 = ステップ2
      let updated = false;

      // timeoutSecondsを60に変更
      if (step2.timeoutSeconds !== undefined && step2.timeoutSeconds !== 60) {
        step2.timeoutSeconds = 60;
        updated = true;
        console.log(`  [${preset.id}] ${preset.name}: timeoutSeconds を ${step2.timeoutSeconds} → 60 に変更`);
      } else if (step2.timeoutSeconds === undefined) {
        step2.timeoutSeconds = 60;
        updated = true;
        console.log(`  [${preset.id}] ${preset.name}: timeoutSeconds を追加 (60)`);
      }

      // options.timeoutMsも確認・更新
      if (step2.options) {
        if (step2.options.timeoutMs !== undefined && step2.options.timeoutMs !== 60000) {
          step2.options.timeoutMs = 60000;
          updated = true;
          console.log(`  [${preset.id}] ${preset.name}: options.timeoutMs を ${step2.options.timeoutMs} → 60000 に変更`);
        } else if (step2.options.timeoutMs === undefined) {
          step2.options.timeoutMs = 60000;
          updated = true;
          console.log(`  [${preset.id}] ${preset.name}: options.timeoutMs を追加 (60000)`);
        }
      } else {
        // optionsが存在しない場合は作成
        step2.options = { timeoutMs: 60000 };
        updated = true;
        console.log(`  [${preset.id}] ${preset.name}: options を追加 (timeoutMs: 60000)`);
      }

      if (updated) {
        const updatedStepsJson = JSON.stringify(steps, null, 2);
        updatePreset(preset.id, preset.name, preset.description || '', updatedStepsJson);
        console.log(`✓ [${preset.id}] ${preset.name}: 更新完了\n`);
        updatedCount++;
      } else {
        console.log(`- [${preset.id}] ${preset.name}: 変更不要（既に60秒に設定済み）\n`);
      }

    } catch (e: any) {
      console.log(`✗ [${preset.id}] ${preset.name}: エラー - ${String(e?.message || e)}\n`);
    }
  }

  console.log(`=== 完了 ===`);
  console.log(`更新されたプリセット数: ${updatedCount}/${allPresets.length}`);
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});















