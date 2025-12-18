/**
 * プリセットID 17のevalステップのチェックロジックを正確に修正するスクリプト
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
      
      // 正確なパターンマッチング: if (!authToken || authToken.trim() === '' || authToken === '{{auth_token}}')
      // 改行や空白を考慮したパターン
      step.code = step.code.replace(
        /if\s*\(\s*!authToken\s*\|\|\s*authToken\.trim\(\)\s*===\s*['"]\s*\|\|\s*authToken\s*===\s*['"]\{\{auth_token\}\}['"]\s*\)/g,
        "if (!authToken || authToken.trim() === '')"
      );
      
      // ct0 のチェックも同様に修正
      step.code = step.code.replace(
        /if\s*\(\s*!ct0\s*\|\|\s*ct0\.trim\(\)\s*===\s*['"]\s*\|\|\s*ct0\s*===\s*['"]\{\{ct0\}\}['"]\s*\)/g,
        "if (!ct0 || ct0.trim() === '')"
      );
      
      if (step.code !== originalCode) {
        updated = true;
        console.log('✅ Code updated');
        // 変更箇所を確認
        const lines = step.code.split('\n');
        const checkLine = lines.find(l => l.includes('authToken') && l.includes('if'));
        if (checkLine) {
          console.log('Updated check line:', checkLine.trim());
        }
      } else {
        console.log('⚠️ No changes detected');
        // 現在のチェック行を表示
        const lines = originalCode.split('\n');
        const checkLine = lines.find(l => l.includes('authToken') && l.includes('if'));
        if (checkLine) {
          console.log('Current check line:', checkLine.trim());
        }
      }
    }
  }
  
  if (updated) {
    updatePreset(17, preset.name, preset.description, JSON.stringify(steps));
    console.log('✅ プリセットID 17を更新しました');
  } else {
    console.log('⚠️ プリセットID 17は更新されませんでした');
    // 手動で置換を試みる
    console.log('手動置換を試みます...');
    for (const step of steps) {
      if (step.type === 'eval' && step.code && step.code.includes('auth_token')) {
        // 文字列置換で直接修正
        const newCode = step.code.replace(
          "if (!authToken || authToken.trim() === '' || authToken === '{{auth_token}}')",
          "if (!authToken || authToken.trim() === '')"
        ).replace(
          "if (!ct0 || ct0.trim() === '' || ct0 === '{{ct0}}')",
          "if (!ct0 || ct0.trim() === '')"
        );
        
        if (newCode !== step.code) {
          step.code = newCode;
          updatePreset(17, preset.name, preset.description, JSON.stringify(steps));
          console.log('✅ 手動置換で更新しました');
          break;
        }
      }
    }
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

