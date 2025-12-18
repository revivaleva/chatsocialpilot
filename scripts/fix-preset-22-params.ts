/**
 * プリセット22の確認コード入力ステップを修正（テンプレート変数パラメータ化）
 * 
 * 問題：eval内の文字列リテラル '{{pr_verification_code}}' が
 *      サーバーの applyTemplate で正しく置換されない
 * 
 * 解決：ステップのparametersとしてテンプレート変数を定義し、
 *      eval内でそれを参照する方式に変更
 */

import Database from 'better-sqlite3';

const db = new Database('./storage/app.db');

const preset = db.prepare('SELECT steps_json FROM presets WHERE id = 22').get() as any;
if (!preset) {
  console.error('❌ プリセット22が見つかりませんでした');
  process.exit(1);
}

const steps = JSON.parse(preset.steps_json || '[]');

// ステップ7（確認コード入力）
const verificationCodeStepIndex = steps.findIndex((s: any) => 
  s.type === 'eval' && s.name && s.name.includes('確認コード')
);

if (verificationCodeStepIndex === -1) {
  console.error('❌ 確認コード入力ステップが見つかりませんでした');
  process.exit(1);
}

const step = steps[verificationCodeStepIndex];
console.log(`✅ ステップ${verificationCodeStepIndex}を修正します: ${step.name}`);

// 修正1: ステップに parameters を追加（テンプレート変数を明示的に定義）
step.parameters = {
  verification_code: '{{pr_verification_code}}'
};

// 修正2: eval コード内でパラメータを参照
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

    // 2. 確認コードを取得
    // ⭐ 重要：parameters から参照（サーバーが自動置換）
    const verificationCode = '{{parameters.verification_code}}';
    const code = (verificationCode || '').trim();

    if (!code || code.length === 0) {
      return { didAction: false, reason: '確認コードが指定されていません' };
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

step.code = updatedCode;
steps[verificationCodeStepIndex] = step;

// DB更新
db.prepare('UPDATE presets SET steps_json = ? WHERE id = 22').run(JSON.stringify(steps));

console.log('✅ プリセットを更新しました');
console.log('\n修正内容:');
console.log('   - step.parameters に verification_code を追加');
console.log('   - eval内で {{parameters.verification_code}} を参照');
console.log('   - サーバーのapplyTemplate処理の対象を適切化');

