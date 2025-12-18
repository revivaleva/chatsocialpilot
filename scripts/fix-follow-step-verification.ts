import { initDb, query } from '../src/drivers/db';
import { updatePreset } from '../src/services/presets';

/**
 * いいね3点セットのフォローステップに要素変化の確認を追加するスクリプト
 * 
 * 修正内容:
 * 1. クリック前にボタンのテキストとaria-labelを保存
 * 2. クリック後に要素が変わったか確認（"Follow" → "Following"）
 * 3. 要素が変わらなかった場合は、フォローできなかったと判断
 */

type PresetRow = {
  id: number;
  name: string;
  description: string;
  steps_json: string;
};

function main() {
  initDb({ wal: true });

  console.log('=== いいね3点セットのフォローステップ修正 ===\n');

  // いいね3点セットのプリセットを取得
  const presets = query<PresetRow>(
    'SELECT id, name, description, steps_json FROM presets WHERE name LIKE ?',
    ['%いいね3点セット%']
  );

  if (presets.length === 0) {
    console.log('いいね3点セットのpresetが見つかりませんでした。');
    return;
  }

  console.log(`対象プリセット数: ${presets.length}\n`);

  let updatedCount = 0;

  for (const preset of presets) {
    try {
      const steps = JSON.parse(preset.steps_json || '[]');
      if (!Array.isArray(steps)) {
        console.log(`[${preset.id}] ${preset.name}: steps_jsonが配列ではありません`);
        continue;
      }

      // フォローステップを探す
      let updated = false;
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (step.type === 'eval' && step.name && (step.name.includes('フォロー') || step.name.includes('follow'))) {
          console.log(`[${preset.id}] ${preset.name}: ステップ ${i + 1} (${step.name}) を修正中...`);

          // 新しいコード（要素変化の確認を追加）
          const newCode = `(async () => {
  let followBtn = document.querySelector("[data-testid$=\\"-follow\\"]") || document.querySelector("[data-testid=\\"follow\\"]") || document.querySelector("[aria-label*=\\"フォロー\\"]");
  if (!followBtn) {
    let waitCount = 0;
    while (!followBtn && waitCount < 15) {
      await new Promise(r => setTimeout(r, 500));
      followBtn = document.querySelector("[data-testid$=\\"-follow\\"]") || document.querySelector("[data-testid=\\"follow\\"]") || document.querySelector("[aria-label*=\\"フォロー\\"]");
      waitCount++;
    }
  }
  if (!followBtn) { return { didAction: false, reason: "follow button not found after navigation" }; }
  
  // クリック前の状態を保存
  const beforeText = followBtn.textContent || followBtn.innerText || "";
  const beforeAriaLabel = followBtn.getAttribute("aria-label") || "";
  const beforeDataTestId = followBtn.getAttribute("data-testid") || "";
  
  const btnText = beforeText + " " + beforeAriaLabel;
  
  // 既にフォロー中の場合はスキップ
  if (btnText.includes("フォロー中") || btnText.includes("Following")) {
    return { didAction: false, reason: "already following" };
  }
  
  // フォローボタンが見つかった場合のみクリック
  if (btnText.includes("Follow") || btnText.includes("フォロー")) {
    followBtn.click();
    
    // クリック後の待機（要素が変わるまで待つ）
    await new Promise(r => setTimeout(r, 2000));
    
    // クリック後の状態を確認
    let afterBtn = document.querySelector("[data-testid$=\\"-unfollow\\"]") || 
                   document.querySelector("[data-testid$=\\"-follow\\"]") || 
                   document.querySelector("[data-testid=\\"follow\\"]") || 
                   document.querySelector("[aria-label*=\\"フォロー\\"]");
    
    if (!afterBtn) {
      // ボタンが見つからない場合は少し待って再試行
      await new Promise(r => setTimeout(r, 1000));
      afterBtn = document.querySelector("[data-testid$=\\"-unfollow\\"]") || 
                 document.querySelector("[data-testid$=\\"-follow\\"]") || 
                 document.querySelector("[data-testid=\\"follow\\"]") || 
                 document.querySelector("[aria-label*=\\"フォロー\\"]");
    }
    
    if (!afterBtn) {
      return { didAction: false, reason: "follow button disappeared after click (possibly failed)" };
    }
    
    // クリック後のテキストを取得
    const afterText = afterBtn.textContent || afterBtn.innerText || "";
    const afterAriaLabel = afterBtn.getAttribute("aria-label") || "";
    const afterDataTestId = afterBtn.getAttribute("data-testid") || "";
    const afterBtnText = afterText + " " + afterAriaLabel;
    
    // 要素が変わったか確認（"Follow" → "Following" または "フォロー" → "フォロー中"）
    const textChanged = (
      (beforeText.includes("Follow") && !beforeText.includes("Following") && afterText.includes("Following")) ||
      (beforeText.includes("フォロー") && !beforeText.includes("フォロー中") && afterText.includes("フォロー中")) ||
      (beforeAriaLabel.includes("Follow") && !beforeAriaLabel.includes("Following") && afterAriaLabel.includes("Following")) ||
      (beforeAriaLabel.includes("フォロー") && !beforeAriaLabel.includes("フォロー中") && afterAriaLabel.includes("フォロー中")) ||
      (beforeDataTestId.endsWith("-follow") && afterDataTestId.endsWith("-unfollow"))
    );
    
    if (textChanged) {
      return { didAction: true, reason: "followed (text changed from Follow to Following)" };
    } else {
      // 要素が変わらなかった場合は、フォローできなかったと判断
      return { didAction: false, reason: "follow button clicked but text did not change (possibly rate limited or blocked)" };
    }
  }
  
  return { didAction: false, reason: "button text does not indicate follow action" };
})()`;

          step.code = newCode;
          updated = true;
          console.log(`  ✓ ステップ ${i + 1} のコードを更新`);
        }
      }

      if (updated) {
        const updatedStepsJson = JSON.stringify(steps, null, 2);
        updatePreset(preset.id, preset.name, preset.description || '', updatedStepsJson);
        console.log(`✓ [${preset.id}] ${preset.name}: 更新完了\n`);
        updatedCount++;
      } else {
        console.log(`- [${preset.id}] ${preset.name}: フォローステップが見つかりませんでした\n`);
      }

    } catch (e: any) {
      console.log(`✗ [${preset.id}] ${preset.name}: エラー - ${String(e?.message || e)}\n`);
    }
  }

  console.log(`=== 完了 ===`);
  console.log(`更新されたプリセット数: ${updatedCount}/${presets.length}`);
}

try {
  main();
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}

