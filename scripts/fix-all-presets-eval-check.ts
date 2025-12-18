/**
 * すべてのX Authログインプリセットのevalステップのチェックロジックを修正するスクリプト
 * 問題: 置換後のコードで `authToken === '実際の値'` という条件が true になってしまう
 * 解決: チェックロジックから置換後の値との比較を削除
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset, listPresets } from '../src/services/presets';

async function main() {
  initDb({ wal: true });
  
  const presets = listPresets();
  const xAuthPresets = presets.filter(p => p.name && p.name.includes('X Auth'));
  
  console.log(`Found ${xAuthPresets.length} X Auth preset(s)`);
  
  for (const preset of xAuthPresets) {
    const steps = JSON.parse(preset.steps_json || '[]');
    let updated = false;
    
    // evalステップを探して修正
    for (const step of steps) {
      if (step.type === 'eval' && step.code && step.code.includes('auth_token')) {
        // チェックロジックを修正: 置換後の値との比較を削除
        // 問題: 置換後のコードで `authToken === '実際の値'` という条件が true になってしまう
        // 解決: テンプレート変数文字列との比較のみをチェック
        
        const originalCode = step.code;
        
        // 置換後の値との比較を削除（authToken === '実際の値' という条件を削除）
        // 問題: 置換後のコードで `authToken === '0d9adaeaf3bbca5645be22d8f4e617fad2c6d814'` が true になってしまう
        // 解決: チェックロジックから置換後の値との比較を削除し、テンプレート変数文字列との比較のみをチェック
        
        // パターン1: if (!authToken || authToken.trim() === '' || authToken === '実際の値')
        step.code = step.code.replace(
          /if \(!authToken \|\| authToken\.trim\(\) === ['"] \|\| authToken === ['"][^'"]+['"]\)/g,
          "if (!authToken || authToken.trim() === '' || authToken === '{{auth_token}}')"
        );
        
        // パターン2: if (!authToken || authToken === '{{auth_token}}' || authToken.trim() === '')
        // これは既に正しい形式なので、置換後の値との比較のみを削除
        step.code = step.code.replace(
          /authToken === ['"][a-f0-9]{40,}['"]/g,
          "authToken === '{{auth_token}}'"
        );
        
        step.code = step.code.replace(
          /if \(!ct0 \|\| ct0\.trim\(\) === ['"] \|\| ct0 === ['"][^'"]+['"]\)/g,
          "if (!ct0 || ct0.trim() === '' || ct0 === '{{ct0}}')"
        );
        
        // パターン2: ct0 の場合も同様
        step.code = step.code.replace(
          /ct0 === ['"][a-f0-9]{100,}['"]/g,
          "ct0 === '{{ct0}}'"
        );
        
        if (step.code !== originalCode) {
          updated = true;
          console.log(`✅ Updated preset ID ${preset.id}`);
        }
      }
    }
    
    if (updated) {
      updatePreset(preset.id, preset.name, preset.description, JSON.stringify(steps));
    }
  }
  
  console.log('✅ All presets updated');
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

