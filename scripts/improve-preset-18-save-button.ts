#!/usr/bin/env tsx
/**
 * プリセット18のステップ13（Saveボタンをクリック）を改善するスクリプト
 * - data-testidだけでなく、テキストコンテンツベースの検索も追加
 * - 日本語の「保存」ボタンにも対応
 */

import { initDb, query, run } from '../src/drivers/db.js';

initDb();

const preset = query<{ id: number; name: string; steps_json: string }>(
  'SELECT id, name, steps_json FROM presets WHERE id = 18'
)[0];

if (!preset) {
  console.error('プリセット18が見つかりません');
  process.exit(1);
}

const steps = JSON.parse(preset.steps_json);

console.log(`プリセット${preset.id}: ${preset.name}`);
console.log(`現在のステップ数: ${steps.length}\n`);

// ステップ13（index 13）を修正: Saveボタンをクリック
if (steps[13] && steps[13].type === 'eval' && steps[13].name === 'Saveボタンをクリック') {
  console.log('ステップ13（Saveボタンをクリック）を改善します...');
  
  const newCode = `(async () => {
  try {
    const startUrl = window.location.href;
    
    // まずdata-testidで検索
    let saveBtn = document.querySelector('button[data-testid="Profile_Save_Button"]');
    
    // data-testidで見つからない場合、テキストコンテンツベースで検索
    if (!saveBtn) {
      const allButtons = document.querySelectorAll('button, [role="button"]');
      for (const btn of allButtons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
        const combined = text + ' ' + ariaLabel;
        
        // 英語のキーワード
        if (combined.includes('save') || combined === 'save') {
          saveBtn = btn;
          console.log('Found Save button by text content (English)');
          break;
        }
        
        // 日本語のキーワード
        if (combined.includes('保存') || combined === '保存') {
          saveBtn = btn;
          console.log('Found Save button by text content (Japanese)');
          break;
        }
        
        // data-testidに"save"が含まれる場合
        const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
        if (testId.includes('save')) {
          saveBtn = btn;
          console.log('Found Save button by data-testid containing "save"');
          break;
        }
      }
    }
    
    if (!saveBtn) {
      return { didAction: false, reason: 'save button not found' };
    }

    let waitCount = 0;
    while ((saveBtn.disabled || saveBtn.getAttribute('aria-disabled') === 'true') && waitCount < 20) {
      await new Promise(r => setTimeout(r, 500));
      
      // 再検索（要素が動的に変更される可能性があるため）
      saveBtn = document.querySelector('button[data-testid="Profile_Save_Button"]');
      if (!saveBtn) {
        // 再度テキストベースで検索
        const allButtons = document.querySelectorAll('button, [role="button"]');
        for (const btn of allButtons) {
          const text = (btn.textContent || '').trim().toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
          const combined = text + ' ' + ariaLabel;
          if (combined.includes('save') || combined === 'save' || combined.includes('保存') || combined === '保存') {
            saveBtn = btn;
            break;
          }
        }
      }
      
      if (!saveBtn) {
        return { didAction: false, reason: 'save button disappeared' };
      }
      waitCount++;
    }

    if (saveBtn.disabled || saveBtn.getAttribute('aria-disabled') === 'true') {
      return { didAction: false, reason: 'save button still disabled after waiting' };
    }

    saveBtn.click();
    await new Promise(r => setTimeout(r, 2000));

    // モーダルが表示された場合の処理
    let modal = document.querySelector('[role="dialog"][aria-labelledby="modal-header"]');
    if (modal) {
      // モーダル内の閉じるボタンを探す
      let closeBtn = modal.querySelector('button[aria-label="Close"]') ||
                     modal.querySelector('button[data-testid="app-bar-close"]');

      // テキストでOKや閉じるボタンを探す（日本語対応拡張）
      if (!closeBtn) {
        const allButtons = modal.querySelectorAll('button');
        for (const btn of allButtons) {
          const text = btn.textContent?.trim() || '';
          const ariaLabel = btn.getAttribute('aria-label')?.trim() || '';
          // 英語
          if (text === 'OK' || text === 'Close' || text.includes('Close') || 
              ariaLabel === 'Close' || ariaLabel.includes('Close')) {
            closeBtn = btn;
            break;
          }
          // 日本語
          if (text === '閉じる' || text.includes('閉じる') || 
              ariaLabel === '閉じる' || ariaLabel.includes('閉じる')) {
            closeBtn = btn;
            break;
          }
        }
      }

      if (closeBtn) {
        closeBtn.click();
        await new Promise(r => setTimeout(r, 1000));
      } else {
        // 閉じるボタンが見つからない場合、ESCキーで閉じる
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // 保存完了の確認（URLが変わる、またはプロフィール編集ページが閉じられるまで待つ）
    let checkCount = 0;
    while (checkCount < 30) {
      const currentUrl = window.location.href;
      // URLが変わった、またはプロフィール編集ページでなくなった場合は保存完了
      if (currentUrl !== startUrl || !currentUrl.includes('/settings/profile')) {
        await new Promise(r => setTimeout(r, 1000));
        return { didAction: true, reason: 'save completed, page navigated away' };
      }
      // モーダルが消えた場合も保存完了の可能性
      modal = document.querySelector('[role="dialog"][aria-labelledby="modal-header"]');
      if (!modal && checkCount > 3) {
        await new Promise(r => setTimeout(r, 1000));
        return { didAction: true, reason: 'save completed, modal closed' };
      }
      await new Promise(r => setTimeout(r, 500));
      checkCount++;
    }

    // タイムアウトした場合でも、Saveボタンが消えていれば保存完了とみなす
    // data-testidとテキストベースの両方で確認
    const stillExistsByTestId = document.querySelector('button[data-testid="Profile_Save_Button"]');
    if (!stillExistsByTestId) {
      // テキストベースでも確認
      const allButtons = document.querySelectorAll('button, [role="button"]');
      let stillExistsByText = false;
      for (const btn of allButtons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
        const combined = text + ' ' + ariaLabel;
        if (combined.includes('save') || combined === 'save' || combined.includes('保存') || combined === '保存') {
          stillExistsByText = true;
          break;
        }
      }
      if (!stillExistsByText) {
        return { didAction: true, reason: 'save completed, save button disappeared' };
      }
    }

    return { didAction: true, reason: 'save button clicked, waiting for completion' };
  } catch (e) {
    return { didAction: false, reason: String(e) };
  }
})()`;

  steps[13].code = newCode;

  console.log('改善内容:');
  console.log('  - data-testidだけでなく、テキストコンテンツベースの検索を追加');
  console.log('  - 日本語の「保存」ボタンに対応');
  console.log('  - data-testidに"save"が含まれるボタンも検索対象に追加');
  console.log('  - ボタン再検索時にテキストベース検索も再実行');
  console.log('  - 保存完了確認時にテキストベース検索も使用');
  console.log('  - モーダルの閉じるボタンの検出を拡張（aria-labelも確認）');
  console.log('  - より詳細なログ出力を追加');

  // データベースを更新
  const updatedStepsJson = JSON.stringify(steps, null, 2);
  run(
    'UPDATE presets SET steps_json = ?, updated_at = ? WHERE id = ?',
    [updatedStepsJson, Date.now(), preset.id]
  );

  console.log('\n✓ プリセット18を更新しました');
  console.log(`  新しいステップ数: ${steps.length}`);
} else {
  console.error('ステップ13（Saveボタンをクリック）が見つからないか、期待する形式ではありません');
  console.log('現在のステップ13:', JSON.stringify(steps[13], null, 2));
  process.exit(1);
}

