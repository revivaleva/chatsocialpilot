import { getPreset, updatePreset } from '../src/services/presets';
import { initDb } from '../src/drivers/db';

// プリセット32のステップ2（テキスト入力）を修正
// ステップ2を2つに分割：
// 2-1: テキストエリア検出確認
// 2-2: キー入力でテキスト入力（シンプル版）

function main() {
  initDb({ wal: true });
  
  const presetId = 32;
  const preset = getPreset(presetId);
  
  if (!preset) {
    console.error(`プリセット ${presetId} が見つかりません`);
    process.exit(1);
  }
  
  console.log(`プリセット ${presetId} を取得しました: ${preset.name}`);
  
  const steps = JSON.parse(preset.steps_json || '[]');
  
  // ステップ2（インデックス1）を2つに分割
  if (steps.length > 1 && steps[1].type === 'eval') {
    const oldCode = steps[1].code;
    console.log('現在のステップ2を2つに分割します...');
    
    // ステップ2-1: テキストエリア検出確認
    const checkCode = `(function() { 
  try { 
    const modal = document.querySelector('[role="dialog"]');
    const textarea = modal ? 
      modal.querySelector('[data-testid="tweetTextarea_0"]') : 
      document.querySelector('[data-testid="tweetTextarea_0"]');
    
    if (textarea) { 
      return { 
        didAction: true, 
        reason: 'textarea found',
        inModal: !!modal,
        selector: '[data-testid="tweetTextarea_0"]'
      }; 
    } 
    return { didAction: false, reason: 'textarea not found' }; 
  } catch(e) { 
    return { didAction: false, reason: String(e) }; 
  } 
})()`;
    
    // ステップ2-2: キー入力でテキスト入力（最シンプル版）
    const inputCode = `(function() { 
  try { 
    const modal = document.querySelector('[role="dialog"]');
    const textarea = modal ? 
      modal.querySelector('[data-testid="tweetTextarea_0"]') : 
      document.querySelector('[data-testid="tweetTextarea_0"]');
    
    if (!textarea) { 
      return { didAction: false, reason: 'textarea not found' }; 
    }
    
    textarea.focus();
    textarea.click();
    
    const text = '{{db_post_content}}';
    
    // 全テキストを一度に insertText で入力
    if (document.execCommand) {
      try {
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, text);
      } catch(e) {
        return { didAction: false, reason: 'execCommand failed: ' + String(e) };
      }
    } else {
      return { didAction: false, reason: 'execCommand not supported' };
    }
    
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    
    return { didAction: true, reason: 'text entered' }; 
  } catch(e) { 
    return { didAction: false, reason: 'error: ' + String(e) }; 
  } 
})()`;
    
    // ステップ2を2つに分割して挿入
    const step2_1 = {
      type: 'eval',
      code: checkCode,
      description: 'テキストエリアの検出確認',
      postWaitSeconds: 1
    };
    
    const step2_2 = {
      type: 'eval',
      code: inputCode,
      description: 'リライト文を入力',
      postWaitSeconds: 2
    };
    
    // ステップ2を削除して、2-1と2-2を挿入
    steps.splice(1, 1, step2_1, step2_2);
    
    const stepsJson = JSON.stringify(steps, null, 2);
    updatePreset(presetId, preset.name, preset.description || '', stepsJson);
    
    console.log('✅ プリセット32のステップ2を2つに分割しました');
    console.log('  - ステップ2-1: テキストエリア検出確認');
    console.log('  - ステップ2-2: キー入力でテキスト入力');
  } else {
    console.error('ステップ2が見つからないか、evalタイプではありません');
    process.exit(1);
  }
}

main();

