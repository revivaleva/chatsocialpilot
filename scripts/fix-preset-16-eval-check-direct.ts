/**
 * プリセットID 16のevalステップのチェックロジックを直接修正するスクリプト
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
      
      // チェックロジック全体を置き換え
      const newCode = step.code.replace(
        /\/\/ 必須パラメータのチェック[\s\S]*?if \(!authToken[^}]+?reason: 'auth_token[^}]+?\}[\s\S]*?if \(!ct0[^}]+?reason: 'ct0[^}]+?\}/,
        `// 必須パラメータのチェック
            // テンプレート変数が置換されていない場合（空文字列またはテンプレート変数文字列のまま）のみエラー
            if (!authToken || authToken.trim() === '' || authToken === '{{auth_token}}') {
              return { 
                didAction: false, 
                reason: 'auth_token が指定されていません。テンプレート変数 {{auth_token}} を指定してください'
              };
            }
            if (!ct0 || ct0.trim() === '' || ct0 === '{{ct0}}') {
              return { 
                didAction: false, 
                reason: 'ct0 が指定されていません。テンプレート変数 {{ct0}} を指定してください'
              };
            }`
      );
      
      if (newCode !== step.code) {
        step.code = newCode;
        console.log('✅ チェックロジックを修正しました');
      } else {
        console.log('⚠️ チェックロジックが見つかりませんでした');
        // 別の方法で試す
        step.code = step.code.replace(
          /if \(!authToken \|\| authToken === ['"]\{\{auth_token\}\}['"] \|\| authToken\.trim\(\) === ['"]/g,
          "if (!authToken || authToken.trim() === '' || authToken === '{{auth_token}}'"
        );
        step.code = step.code.replace(
          /if \(!ct0 \|\| ct0 === ['"]\{\{ct0\}\}['"] \|\| ct0\.trim\(\) === ['"]/g,
          "if (!ct0 || ct0.trim() === '' || ct0 === '{{ct0}}'"
        );
        console.log('✅ 個別に置換しました');
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

