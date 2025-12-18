/**
 * プリセットID 16のevalステップのチェックロジックを修正するスクリプト
 * 問題: テンプレート変数が置換された後、チェックロジックが置換後の値と比較して誤判定している
 * 解決: チェックロジックを修正し、テンプレート変数が置換されていない場合のみエラーにする
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset } from '../src/services/presets';

async function main() {
  initDb({ wal: true });
  
  const preset = getPreset(16);
  if (!preset) {
    console.error('プリセットID 16が見つかりません');
    process.exit(1);
  }
  
  const steps = JSON.parse(preset.steps_json || '[]');
  
  // evalステップを探して修正
  for (const step of steps) {
    if (step.type === 'eval' && step.code && step.code.includes('auth_token')) {
      // チェックロジックを完全に置き換え
      // 問題: 置換後のコードで `authToken === '実際の値'` という条件が true になってしまう
      // 解決: テンプレート変数文字列との比較のみをチェックし、置換後の値との比較は行わない
      
      // チェックロジック全体を置き換え（より確実な方法）
      const originalCode = step.code;
      
      // authToken のチェック部分を置き換え
      step.code = step.code.replace(
        /if \(!authToken \|\| authToken === ['"]\{\{auth_token\}\}['"] \|\| authToken\.trim\(\) === ['"]/g,
        "if (!authToken || authToken.trim() === '' || authToken === '{{auth_token}}'"
      );
      
      // ct0 のチェック部分を置き換え
      step.code = step.code.replace(
        /if \(!ct0 \|\| ct0 === ['"]\{\{ct0\}\}['"] \|\| ct0\.trim\(\) === ['"]/g,
        "if (!ct0 || ct0.trim() === '' || ct0 === '{{ct0}}'"
      );
      
      if (step.code !== originalCode) {
        console.log('✅ チェックロジックを修正しました');
      } else {
        console.log('⚠️ チェックロジックが見つかりませんでした');
      }
    }
  }
  
  const result = updatePreset(16, preset.name, preset.description, JSON.stringify(steps));
  console.log('✅ プリセットID 16を更新しました');
  console.log(`   ステップ数: ${steps.length}`);
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

