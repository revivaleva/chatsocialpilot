/**
 * すべてのX Authログインプリセットのevalステップのチェックロジックを修正するスクリプト
 * 問題: テンプレート変数の置換処理がチェックロジック内の '{{auth_token}}' も置換してしまう
 * 解決: チェックロジックからテンプレート変数文字列との比較を削除し、空文字列チェックのみにする
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
        const originalCode = step.code;
        
        // チェックロジックを修正: テンプレート変数文字列との比較を削除
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

