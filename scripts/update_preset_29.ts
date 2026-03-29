
import { initDb, query, run } from '../src/drivers/db.js';

const modalHandlingCode = (function () {
    return `(function() {
  try {
    let dismissedCount = 0;
    
    function clickIfVisible(el) {
      if (el && el.offsetParent !== null) {
        el.click();
        return true;
      }
      return false;
    }

    // 1. Precise selectors
    const selectors = [
      '[data-testid="sheetDislikeButton"]',
      '[data-testid="app-bar-close"]',
      '[data-testid="ocfSettingsListNextButton"]',
      '[data-testid="OCF_CollapsibleList_Selector_Next_Button"]',
      '[data-testid="ChoiceSelectionNextButton"]',
      '[data-testid="ConfirmationSheetConfirmButton"]',
      '[data-testid="reminder_bar_close"]'
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        if (clickIfVisible(el)) dismissedCount++;
      });
    }

    // 2. Text-based buttons (Specific phrases)
    const buttonTexts = [
      'Not now', 'Skip', 'Dismiss', 'Maybe later', 'Close',
      'キャンセル', 'スキップ', '閉じる', '後で', 'あとで',
      'Yes, looks good', 'はい、正しいです', 
      'Got it', '了解',
      'Remind me later'
    ];
    document.querySelectorAll('div[role="button"], button, span').forEach(el => {
      const text = el.textContent || '';
      // Only click if it's a button-like element or has a specific role
      const clickable = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.classList.contains('css-18t94o4'); 
      if (clickable && buttonTexts.some(t => text.trim() === t || text.includes(t))) {
        if (clickIfVisible(el)) dismissedCount++;
      }
    });

    return {
      ok: true,
      dismissedCount,
      reason: dismissedCount > 0 ? dismissedCount + ' modals dismissed' : 'No modals found'
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`;
})();

async function main() {
    initDb();

    const rows = query('SELECT steps_json FROM presets WHERE id = 29', []);
    if (!rows || rows.length === 0) {
        console.error('Preset 29 not found');
        return;
    }

    const steps = JSON.parse((rows[0] as any).steps_json);

    // Remove existing modal handling if present
    const filteredSteps = steps.filter((s: any) => s.name !== "モーダル処理");

    // Insert modal handling after first navigate (Step 0)
    const modalStep = {
        "type": "eval",
        "name": "モーダル処理",
        "code": modalHandlingCode,
        "postWaitSeconds": 3,
        "options": {
            "timeoutMs": 10000
        }
    };
    filteredSteps.splice(1, 0, modalStep);

    const newStepsJson = JSON.stringify(filteredSteps);
    run('UPDATE presets SET steps_json = ?, updated_at = ? WHERE id = ?', [newStepsJson, Date.now(), 29]);
    console.log('Preset 29 updated with modal handling step');
}

main().catch(console.error);
