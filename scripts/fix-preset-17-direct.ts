/**
 * プリセットID 17のevalステップのチェックロジックを直接修正するスクリプト
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset } from '../src/services/presets';

async function main() {
  initDb({ wal: true });
  
  const preset = getPreset(17);
  if (!preset) {
    console.error('プリセットID 17が見つかりません');
    process.exit(1);
  }
  
  const steps = JSON.parse(preset.steps_json || '[]');
  let updated = false;
  
  // evalステップを探して修正
  for (const step of steps) {
    if (step.type === 'eval' && step.code && step.code.includes('auth_token')) {
      const originalCode = step.code;
      
      // チェックロジックを完全に置き換え
      // 問題: テンプレート変数の置換処理が '{{auth_token}}' も置換してしまう
      // 解決: 空文字列チェックのみにする
      
      // パターン1: if (!authToken || authToken.trim() === '' || authToken === '{{auth_token}}')
      step.code = step.code.replace(
        /if \(!authToken \|\| authToken\.trim\(\) === ['"] \|\| authToken === ['"]\{\{auth_token\}\}['"]\)/g,
        "if (!authToken || authToken.trim() === '')"
      );
      
      // パターン2: 置換後の値との比較（authToken === '実際の値'）を削除
      step.code = step.code.replace(
        /authToken === ['"][a-f0-9]{40,}['"]/g,
        "false // authToken check removed"
      );
      
      // ct0 のチェックも同様に修正
      step.code = step.code.replace(
        /if \(!ct0 \|\| ct0\.trim\(\) === ['"] \|\| ct0 === ['"]\{\{ct0\}\}['"]\)/g,
        "if (!ct0 || ct0.trim() === '')"
      );
      
      // パターン2: 置換後の値との比較（ct0 === '実際の値'）を削除
      step.code = step.code.replace(
        /ct0 === ['"][a-f0-9]{100,}['"]/g,
        "false // ct0 check removed"
      );
      
      if (step.code !== originalCode) {
        updated = true;
        console.log('✅ Code updated');
        console.log('Before:', originalCode.substring(0, 200));
        console.log('After:', step.code.substring(0, 200));
      } else {
        console.log('⚠️ No changes detected');
        console.log('Current code:', step.code.substring(0, 300));
      }
    }
  }
  
  if (updated) {
    updatePreset(17, preset.name, preset.description, JSON.stringify(steps));
    console.log('✅ プリセットID 17を更新しました');
  } else {
    console.log('⚠️ プリセットID 17は更新されませんでした');
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

