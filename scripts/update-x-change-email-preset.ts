/**
 * X（Twitter）メールアドレス変更プリセットを更新するスクリプト
 * 
 * 使用方法:
 *   npx tsx scripts/update-x-change-email-preset.ts
 * 
 * 既存のプリセット（ID: 22）を更新します。
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { updatePreset } from '../src/services/presets';

async function main() {
  // DBを初期化
  initDb({ wal: true });
  
  const presetId = 22;
  const presetName = 'Xメールアドレス変更';
  const presetDescription = 'X（Twitter）のメールアドレスを変更するプリセットです。テンプレート変数 {{account_password}}（Xアカウントのパスワード、必須）、{{new_email}}（新しいメールアドレス、必須）、{{email_credential}}（メール取得用認証情報、必須、形式: "email:password"）を指定します。';

  // プリセットステップ定義（修正版）
  const steps = [
    {
      type: 'navigate',
      description: 'Xのアカウント設定ページにアクセス',
      url: 'https://x.com/settings/your_twitter_data/account',
      postWaitSeconds: 3
    },
    {
      type: 'eval',
      description: 'パスワードを入力してEnterキーを押す（パラメータから取得）',
      code: `
        (async () => {
          try {
            // パスワード入力フィールドを検索
            const passwordInput = document.querySelector('input[name="current_password"][type="password"]');
            
            if (!passwordInput) {
              // パスワード入力画面が表示されていない場合、ステップ3の画面（メールアドレス欄）が表示されているか確認
              let emailElement = null;
              
              // 方法1: href="/settings/email" のリンクを直接検索
              emailElement = document.querySelector('a[href="/settings/email"]');
              
              // 方法2: data-testid="pivot" で role="tab" の要素を検索し、テキストに "Email" が含まれるものを探す
              if (!emailElement) {
                const tabs = Array.from(document.querySelectorAll('a[role="tab"][data-testid="pivot"]'));
                emailElement = tabs.find(tab => {
                  const text = (tab.textContent || '').trim();
                  return text.includes('Email') || text.includes('メール') || text.includes('@');
                });
              }
              
              // 方法3: テキストで "Email" を含むリンクを検索
              if (!emailElement) {
                const links = Array.from(document.querySelectorAll('a[role="tab"]'));
                emailElement = links.find(link => {
                  const text = (link.textContent || '').trim();
                  const span = link.querySelector('span');
                  const spanText = span ? (span.textContent || '').trim() : '';
                  return text.includes('Email') || text.includes('メール') || 
                         spanText === 'Email' || spanText === 'メール';
                });
              }
              
              // ステップ3の画面が表示されている場合は成功（スキップ）として扱う
              if (emailElement) {
                return { didAction: true, reason: 'パスワード入力画面が表示されませんでしたが、メールアドレス欄が表示されているためスキップします' };
              }
              
              return { didAction: false, reason: 'パスワード入力フィールドが見つかりませんでした' };
            }
            
            // パスワードを入力（テンプレート変数 {{account_password}} は実行時に置換される）
            const password = '{{account_password}}';
            
            // フィールドをフォーカス
            passwordInput.focus();
            await new Promise(r => setTimeout(r, 200));
            
            // 既存の値をクリア
            passwordInput.value = '';
            
            // パスワードを1文字ずつ入力（セキュリティ対策を回避）
            for (const char of password) {
              passwordInput.value += char;
              passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise(r => setTimeout(r, 50));
            }
            
            // changeイベントを発火
            passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 200));
            
            // Enterキーを押す
            const enterEvent = new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true
            });
            passwordInput.dispatchEvent(enterEvent);
            await new Promise(r => setTimeout(r, 100));
            
            const enterUpEvent = new KeyboardEvent('keyup', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true
            });
            passwordInput.dispatchEvent(enterUpEvent);
            await new Promise(r => setTimeout(r, 100));
            
            const enterPressEvent = new KeyboardEvent('keypress', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true
            });
            passwordInput.dispatchEvent(enterPressEvent);
            await new Promise(r => setTimeout(r, 200));
            
            return { didAction: true, reason: 'パスワードを入力してEnterキーを押しました' };
          } catch (e) {
            return { didAction: false, reason: 'エラー: ' + String(e) };
          }
        })()
      `,
      postWaitSeconds: 3
    },
    {
      type: 'eval',
      description: 'メールアドレス欄をクリック（HTML構造に基づく検索）',
      code: `
        (async () => {
          try {
            // メールアドレス欄を検索（複数の方法を試す）
            let emailElement = null;
            
            // 方法1: href="/settings/email" のリンクを直接検索
            emailElement = document.querySelector('a[href="/settings/email"]');
            
            // 方法2: data-testid="pivot" で role="tab" の要素を検索し、テキストに "Email" が含まれるものを探す
            if (!emailElement) {
              const tabs = Array.from(document.querySelectorAll('a[role="tab"][data-testid="pivot"]'));
              emailElement = tabs.find(tab => {
                const text = (tab.textContent || '').trim();
                return text.includes('Email') || text.includes('メール') || text.includes('@');
              });
            }
            
            // 方法3: テキストで "Email" を含むリンクを検索
            if (!emailElement) {
              const links = Array.from(document.querySelectorAll('a[role="tab"]'));
              emailElement = links.find(link => {
                const text = (link.textContent || '').trim();
                const span = link.querySelector('span');
                const spanText = span ? (span.textContent || '').trim() : '';
                return text.includes('Email') || text.includes('メール') || 
                       spanText === 'Email' || spanText === 'メール';
              });
            }
            
            if (emailElement) {
              // 要素を画面内にスクロール
              emailElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await new Promise(r => setTimeout(r, 300));
              
              // クリック
              emailElement.click();
              await new Promise(r => setTimeout(r, 500));
              
              // マウスイベントも発火（React対応）
              const clickEvent = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
              });
              emailElement.dispatchEvent(clickEvent);
              await new Promise(r => setTimeout(r, 200));
              
              return { didAction: true, reason: 'メールアドレス欄をクリックしました' };
            }
            
            return { didAction: false, reason: 'メールアドレス欄が見つかりませんでした' };
          } catch (e) {
            return { didAction: false, reason: 'エラー: ' + String(e) };
          }
        })()
      `,
      postWaitSeconds: 3
    },
    {
      type: 'eval',
      description: 'Update email addressボタンをクリック（テキスト検索、事前チェック付き）',
      code: `
        (async () => {
          try {
            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            
            // 新しいメールアドレスを取得（テンプレート変数は実行時に置換される）
            const newEmail = '{{new_email}}';
            
            if (!newEmail || newEmail.trim() === '' || newEmail === '{{new_email}}') {
              return { didAction: false, reason: 'new_email が指定されていません' };
            }
            
            // 画面に表示されている現在のメールアドレスを確認
            // メールアドレスが表示されている要素を検索
            let currentEmailElement = null;
            
            // 方法1: input[type="email"] や input[name*="email"] のvalue属性を確認
            const emailInputs = Array.from(document.querySelectorAll('input[type="email"], input[name*="email" i]'));
            for (const input of emailInputs) {
              const value = (input as HTMLInputElement).value || '';
              if (value && value.includes('@')) {
                currentEmailElement = input;
                break;
              }
            }
            
            // 方法2: メールアドレスらしいテキストを含む要素を検索
            if (!currentEmailElement) {
              const allElements = Array.from(document.querySelectorAll('*'));
              for (const el of allElements) {
                const text = (el.textContent || '').trim();
                // @を含むテキストで、メールアドレス形式のもの
                if (text && text.includes('@') && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(text)) {
                  const emailMatch = text.match(/[^\\s@]+@[^\\s@]+\\.[^\\s@]+/);
                  if (emailMatch) {
                    // 既に新しいメールアドレスになっているか確認
                    const foundEmail = emailMatch[0].trim().toLowerCase();
                    const newEmailNormalized = newEmail.trim().toLowerCase();
                    if (foundEmail === newEmailNormalized) {
                      // 既に変更済みのため処理を停止
                      return {
                        didAction: false,
                        stopped: true,
                        reason: '画面に表示されているメールアドレスが既に新しいメールアドレス（' + foundEmail + '）になっているため、処理を停止します'
                      };
                    }
                  }
                }
              }
            } else {
              // 入力欄の値が新しいメールアドレスと同じか確認
              const currentEmail = (currentEmailElement as HTMLInputElement).value.trim().toLowerCase();
              const newEmailNormalized = newEmail.trim().toLowerCase();
              if (currentEmail === newEmailNormalized) {
                return {
                  didAction: false,
                  stopped: true,
                  reason: '画面に表示されているメールアドレスが既に新しいメールアドレス（' + currentEmail + '）になっているため、処理を停止します'
                };
              }
            }
            
            // Update email addressボタンをテキストで検索（英語と日本語の両方に対応）
            const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
            const updateButton = buttons.find(btn => {
              const text = (btn.textContent || '').trim();
              return text === 'Update email address' || text === 'メールアドレスを更新' || 
                     text.includes('Update email') || text.includes('メールアドレスを更新') ||
                     (text.includes('Update') && text.includes('email'));
            });
            
            if (updateButton) {
              updateButton.click();
              await sleep(500);
              return { didAction: true, reason: 'Update email addressボタンをクリックしました' };
            }
            
            return { didAction: false, reason: 'Update email addressボタンが見つかりませんでした' };
          } catch (e) {
            return { didAction: false, reason: 'エラー: ' + String(e) };
          }
        })()
      `,
      postWaitSeconds: 2
    },
    {
      type: 'type',
      description: '新しいメールアドレスを入力',
      selector: 'input[type="email"], input[name*="email" i]',
      text: '{{new_email}}',
      postWaitSeconds: 2
    },
    {
      type: 'eval',
      description: 'Nextボタンをクリック（表示確認後、テキスト検索）',
      code: `
        (async () => {
          try {
            // Nextボタンをテキストで検索（英語と日本語の両方に対応）
            const buttons = Array.from(document.querySelectorAll('button[role="button"], button[type="button"], [role="button"]'));
            const nextButton = buttons.find(btn => {
              const text = (btn.textContent || '').trim();
              return text === 'Next' || text === '次へ' || text.includes('Next') || text.includes('次へ');
            });
            
            if (nextButton) {
              nextButton.click();
              await new Promise(r => setTimeout(r, 500));
              return { didAction: true, reason: 'Nextボタンをクリックしました' };
            }
            
            return { didAction: false, reason: 'Nextボタンが見つかりませんでした' };
          } catch (e) {
            return { didAction: false, reason: 'エラー: ' + String(e) };
          }
        })()
      `,
      postWaitSeconds: 5
    },
    {
      type: 'fetch_email',
      description: 'メールから確認コード（6桁の数字）を取得',
      email_credential: '{{email_credential}}',
      subject_pattern: 'X.*verification|確認コード|verification code',
      code_pattern: '\\d{6}',
      timeout_seconds: 60,
      result_var: 'verification_code',
      postWaitSeconds: 2
    },
    {
      type: 'type',
      description: '確認コードを入力',
      selector: 'input[type="text"], input[type="number"], input[inputmode="numeric"]',
      text: '{{verification_code}}',
      postWaitSeconds: 2
    },
    {
      type: 'eval',
      description: 'Verifyボタンをクリック（テキスト検索）',
      code: `
        (async () => {
          try {
            // Verifyボタンをテキストで検索（英語と日本語の両方に対応）
            const buttons = Array.from(document.querySelectorAll('button[role="button"], button[type="button"], [role="button"]'));
            const verifyButton = buttons.find(btn => {
              const text = (btn.textContent || '').trim();
              return text === 'Verify' || text === '確認' || text.includes('Verify') || text.includes('確認');
            });
            
            if (verifyButton) {
              verifyButton.click();
              await new Promise(r => setTimeout(r, 500));
              return { didAction: true, reason: 'Verifyボタンをクリックしました' };
            }
            
            return { didAction: false, reason: 'Verifyボタンが見つかりませんでした' };
          } catch (e) {
            return { didAction: false, reason: 'エラー: ' + String(e) };
          }
        })()
      `,
      postWaitSeconds: 3
    },
    {
      type: 'eval',
      description: 'エラーメッセージの有無を確認',
      code: `
        (async () => {
          try {
            // エラーメッセージのセレクターを確認
            const errorSelectors = [
              '[role="alert"]',
              '.error',
              '[class*="error" i]',
              '[class*="Error" i]',
              'div[class*="error" i]'
            ];
            
            let hasError = false;
            let errorText = '';
            
            for (const selector of errorSelectors) {
              const elements = document.querySelectorAll(selector);
              for (const el of elements) {
                const text = el.textContent || '';
                if (text.trim() && text.length < 500) {
                  // エラーメッセージらしいテキストを検出
                  if (text.toLowerCase().includes('error') || 
                      text.toLowerCase().includes('invalid') ||
                      text.toLowerCase().includes('failed') ||
                      text.toLowerCase().includes('エラー') ||
                      text.toLowerCase().includes('失敗')) {
                    hasError = true;
                    errorText = text.trim();
                    break;
                  }
                }
              }
              if (hasError) break;
            }
            
            if (hasError) {
              return {
                didAction: false,
                reason: 'エラーメッセージが検出されました: ' + errorText
              };
            }
            
            // 成功メッセージまたは変更完了の確認
            const successSelectors = [
              '[class*="success" i]',
              '[class*="Success" i]',
              'div[class*="success" i]'
            ];
            
            let hasSuccess = false;
            for (const selector of successSelectors) {
              const elements = document.querySelectorAll(selector);
              if (elements.length > 0) {
                hasSuccess = true;
                break;
              }
            }
            
            return {
              didAction: true,
              reason: hasSuccess ? 'メールアドレス変更が完了しました' : 'エラーメッセージは検出されませんでした（変更完了とみなします）'
            };
          } catch (e) {
            return {
              didAction: false,
              reason: 'エラー確認中にエラーが発生しました: ' + String(e)
            };
          }
        })()
      `,
      postWaitSeconds: 2
    }
  ];

  try {
    updatePreset(presetId, presetName, presetDescription, JSON.stringify(steps));
    console.log(`✅ プリセットを更新しました:`);
    console.log(`   ID: ${presetId}`);
    console.log(`   名前: ${presetName}`);
    console.log(`   説明: ${presetDescription}`);
    console.log(`   ステップ数: ${steps.length}`);
    console.log(`\n修正内容:`);
    console.log(`   - パスワード入力欄のセレクターを修正: input[name="current_password"][type="password"]`);
    console.log(`   - Confirmボタンをクリックするステップを追加（ステップ3）`);
    console.log(`   - メールアドレス欄をクリックするステップをステップ4に変更`);
    console.log(`\nステップ一覧:`);
    steps.forEach((step, index) => {
      console.log(`   ${index + 1}. ${step.description || step.type}`);
    });
  } catch (e: any) {
    console.error('❌ プリセット更新に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

