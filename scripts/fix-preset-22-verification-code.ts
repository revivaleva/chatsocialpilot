/**
 * プリセット22の確認コード入力ステップを修正
 * 
 * 問題: 確認コード入力フィールドが見つからない
 * 原因: HTMLでは name="verfication_code" という属性があるが、現在の検索条件では見つからない
 * 修正: name属性、ラベルテキスト、モーダル内の検索を追加
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset } from '../src/services/presets';

async function main() {
  initDb({ wal: true });
  
  const presetId = 22;
  const preset = getPreset(presetId);
  
  if (!preset) {
    console.error('❌ プリセットが見つかりませんでした');
    process.exit(1);
  }
  
  const steps = JSON.parse((preset as any).steps_json || '[]');
  
  // ステップ7（確認コード入力）を探す
  // ログから、ステップ7が「確認コードを入力（キー入力方式）」であることが分かる
  const verificationCodeStepIndex = steps.findIndex((s: any) => 
    (s.description && s.description.includes('確認コードを入力')) ||
    (s.name && s.name.includes('確認コードを入力'))
  );
  
  if (verificationCodeStepIndex === -1) {
    console.error('❌ 確認コード入力ステップが見つかりませんでした');
    process.exit(1);
  }
  
  const step = steps[verificationCodeStepIndex];
  console.log(`✅ ステップ${verificationCodeStepIndex + 1}を修正します: ${step.description}`);
  
  // 修正後のコード（ユーザーが追加したモーダル検索ロジックを維持）
  const updatedCode = `(async () => {
  try {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 1. 確認コード入力フィールドを検索（複数の方法を試す）
    let codeInput = null;

    // ✅ 優先1: 「We sent you a code」モーダル内だけを対象にする
    const dialogs = Array.from(
      document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="dialog"]')
    );

    const targetDialog =
      dialogs.find(el => {
        const text = (el.textContent || '').toLowerCase();
        return (
          text.includes('we sent you a code') || // 見出し
          text.includes('enter it below to verify your email') // 説明文
        );
      }) || dialogs[0] || null;

    if (targetDialog) {
      // 方法1: name="verfication_code"（typo含む）/ name="verification_code" で検索
      codeInput =
        targetDialog.querySelector('input[name="verfication_code"]') ||
        targetDialog.querySelector('input[name="verification_code"]');

      // 方法2: ラベルテキスト「Verification code / 確認コード」から input を特定
      if (!codeInput) {
        const labels = Array.from(targetDialog.querySelectorAll('label'));
        for (const label of labels) {
          const labelText = (label.textContent || '').toLowerCase();
          if (
            labelText.includes('verification code') ||
            labelText.includes('verification') ||
            labelText.includes('code') ||
            labelText.includes('確認コード') ||
            labelText.includes('確認')
          ) {
            const directInput = label.querySelector('input');
            if (directInput) {
              codeInput = directInput;
              break;
            }
            const forAttr = label.getAttribute('for');
            if (forAttr) {
              const inputById = document.getElementById(forAttr);
              if (inputById && inputById.tagName === 'INPUT') {
                codeInput = inputById;
                break;
              }
            }
          }
        }
      }

      // 方法3: まだ見つからなければ、モーダル内の text / tel / numeric input から絞り込み
      if (!codeInput) {
        const modalInputs = Array.from(
          targetDialog.querySelectorAll('input[type="text"], input[type="tel"], input[inputmode="numeric"]')
        );

        codeInput =
          modalInputs.find(input => {
            const name = (input.getAttribute('name') || '').toLowerCase();
            const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
            const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
            return (
              name.includes('verfication') ||
              name.includes('verification') ||
              name.includes('code') ||
              placeholder.includes('code') ||
              placeholder.includes('verification') ||
              placeholder.includes('確認') ||
              ariaLabel.includes('code') ||
              ariaLabel.includes('verification')
            );
          }) || modalInputs[0] || null;
      }
    }

    // ✅ 最後のフォールバック: ドキュメント全体を name で検索
    if (!codeInput) {
      codeInput =
        document.querySelector('input[name="verfication_code"]') ||
        document.querySelector('input[name="verification_code"]');
    }

    if (!codeInput) {
      return { didAction: false, reason: '確認コード入力フィールドが見つかりませんでした' };
    }

    // 2. 確認コードを取得（テンプレート変数は実行時に置換される前提）
    const rawCode = '{{pr_verification_code}}';
    const code = (rawCode || '').trim();

    if (!code || !code.trim() || code === '{{pr_verification_code}}') {
      return { didAction: false, reason: 'pr_verification_code が指定されていません' };
    }

    // 3. 確認コード欄に値を設定（React 対応）
    codeInput.focus();
    codeInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) {
      setter.call(codeInput, code);
    } else {
      codeInput.value = code;
    }

    codeInput.dispatchEvent(new Event('input', { bubbles: true }));
    codeInput.dispatchEvent(new Event('change', { bubbles: true }));

    await sleep(300);

    return { didAction: true, reason: '確認コードを入力しました: ' + code };
  } catch (e) {
    return { didAction: false, reason: 'エラー: ' + String(e) };
  }
})()`;
  
  // ステップを更新
  step.code = updatedCode;
  steps[verificationCodeStepIndex] = step;
  
  // プリセットを更新
  updatePreset(
    presetId,
    (preset as any).name,
    (preset as any).description,
    JSON.stringify(steps)
  );
  
  console.log('✅ プリセットを更新しました');
  console.log(`   ステップ${verificationCodeStepIndex + 1}: ${step.description}`);
  console.log('\n修正内容:');
  console.log('   - name="verfication_code" で検索を追加（typoを含む）');
  console.log('   - name="verification_code" で検索を追加（正しいスペル）');
  console.log('   - ラベルテキストで「Verification code」を含むinputを検索');
  console.log('   - モーダル内のinputを優先的に検索');
  console.log('   - 複数のフォールバック検索方法を追加');
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});
