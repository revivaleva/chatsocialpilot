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
      console.log('Found eval step with auth_token');
      
      // チェックロジックを完全に置き換え
      // 問題: 置換後のコードで `authToken === '実際の値'` という条件が true になってしまう
      // 解決: テンプレート変数文字列との比較のみをチェックし、置換後の値との比較は行わない
      
      // 元のコードを確認
      const originalCode = step.code;
      console.log('Original code snippet:', originalCode.substring(0, 200));
      
      // チェックロジック全体を置き換え
      const authTokenCheckRegex = /\/\/ 必須パラメータのチェック[\s\S]*?if \(!authToken[^}]+?reason: 'auth_token[^}]+?\}/;
      const newAuthTokenCheck = `// 必須パラメータのチェック
            // テンプレート変数が置換されていない場合（空文字列またはテンプレート変数文字列のまま）のみエラー
            if (!authToken || authToken.trim() === '' || authToken === '{{auth_token}}') {
              return { 
                didAction: false, 
                reason: 'auth_token が指定されていません。テンプレート変数 {{auth_token}} を指定してください'
              };
            }`;
      
      if (authTokenCheckRegex.test(step.code)) {
        step.code = step.code.replace(authTokenCheckRegex, newAuthTokenCheck);
        console.log('✅ authToken check replaced');
      } else {
        console.log('⚠️ authToken check pattern not found');
      }
      
      const ct0CheckRegex = /if \(!ct0[^}]+?reason: 'ct0[^}]+?\}/;
      const newCt0Check = `if (!ct0 || ct0.trim() === '' || ct0 === '{{ct0}}') {
              return { 
                didAction: false, 
                reason: 'ct0 が指定されていません。テンプレート変数 {{ct0}} を指定してください'
              };
            }`;
      
      if (ct0CheckRegex.test(step.code)) {
        step.code = step.code.replace(ct0CheckRegex, newCt0Check);
        console.log('✅ ct0 check replaced');
      } else {
        console.log('⚠️ ct0 check pattern not found');
      }
      
      // 修正後のコードを確認
      console.log('Updated code snippet:', step.code.substring(0, 200));
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

