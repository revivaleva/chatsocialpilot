import { initDb, query, run } from '../src/drivers/db';
import { updatePreset } from '../src/services/presets';

/**
 * いいね3点セットの4リプライステップのメッセージを修正するスクリプト
 * 「初めまして|はじめまして」の後に絵文字をランダムに追加
 */

type PresetRow = {
  id: number;
  name: string;
  description: string;
  steps_json: string;
};

// 絵文字のリスト
const emojis = ['🌿', '🌸', '💐', '🌼', '🌷'];

// スピンテキストを生成（初めまして/はじめまして × 各絵文字）
function generateSpinText(): string {
  const greetings = ['初めまして', 'はじめまして'];
  const combinations: string[] = [];
  
  for (const greeting of greetings) {
    for (const emoji of emojis) {
      combinations.push(`${greeting}${emoji}`);
    }
  }
  
  return combinations.join('|');
}

async function main() {
  initDb({ wal: true });
  
  console.log('=== いいね3点セットの4リプライステップ修正 ===\n');
  
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
  
  const newSpinText = generateSpinText();
  console.log(`新しいスピンテキスト: ${newSpinText}\n`);
  
  let updatedCount = 0;
  
  for (const preset of allPresets) {
    try {
      const steps = JSON.parse(preset.steps_json || '[]');
      if (!Array.isArray(steps)) {
        console.log(`[${preset.id}] ${preset.name}: steps_jsonが配列ではありません`);
        continue;
      }
      
      // 4番目のステップ（インデックス3）を探す
      // リプライステップで「初めまして|はじめまして」を含むものを探す
      let found = false;
      const updatedSteps = steps.map((step: any, index: number) => {
        if (step.code && typeof step.code === 'string') {
          // スピンテキスト「初めまして|はじめまして」を含むか確認
          if (step.code.includes('初めまして|はじめまして') || 
              step.code.includes('"初めまして|はじめまして"') ||
              step.code.includes("'初めまして|はじめまして'")) {
            found = true;
            // スピンテキストを置換
            const updatedCode = step.code
              .replace(/spinText\s*=\s*["']初めまして\|はじめまして["']/g, `spinText = "${newSpinText}"`)
              .replace(/["']初めまして\|はじめまして["']/g, `"${newSpinText}"`);
            
            return { ...step, code: updatedCode };
          }
        }
        return step;
      });
      
      if (found) {
        const updatedStepsJson = JSON.stringify(updatedSteps);
        updatePreset(preset.id, preset.name, preset.description || '', updatedStepsJson);
        console.log(`✓ [${preset.id}] ${preset.name}: 更新完了`);
        updatedCount++;
      } else {
        console.log(`- [${preset.id}] ${preset.name}: 該当ステップが見つかりませんでした`);
      }
      
    } catch (e: any) {
      console.log(`✗ [${preset.id}] ${preset.name}: エラー - ${String(e?.message || e)}`);
    }
  }
  
  console.log(`\n=== 完了 ===`);
  console.log(`更新されたプリセット数: ${updatedCount}/${allPresets.length}`);
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

