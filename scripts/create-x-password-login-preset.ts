/**
 * Xのパスワードログインプリセットを作成するスクリプト
 * 
 * 使用方法:
 *   npx tsx scripts/create-x-password-login-preset.ts
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { createPreset } from '../src/services/presets';

async function main() {
  // DBを初期化
  initDb({ wal: true });
  
  const presetName = 'X パスワードログイン';
  const presetDescription = 'X（旧Twitter）にユーザー名とパスワードでログインします。テンプレート変数 {{container_name}}（コンテナ名、必須）、{{x_username}}（Xユーザー名、必須）、{{x_password}}（パスワード、必須）、{{twofa_code}}（2FAコード、オプション）を指定してコンテナを作成/開き、ログインを実行します。';

  // プリセットステップ定義
  const steps = [
    {
      type: 'container',
      description: 'コンテナ指定',
      container_name: '{{container_name}}',
      postWaitSeconds: 1
    },
    {
      type: 'navigate',
      description: 'Xのログインページに移動',
      url: 'https://x.com/i/flow/login',
      expected: {
        urlContains: 'x.com'
      },
      postWaitSeconds: 3
    },
    {
      type: 'eval',
      description: 'ユーザー名を入力',
      code: `
        (async () => {
          try {
            const username = '{{x_username}}';
            
            if (!username || username.trim() === '') {
              return { 
                didAction: false, 
                reason: 'x_username が指定されていません。テンプレート変数 {{x_username}} を指定してください'
              };
            }
            
            // ユーザー名入力欄を探す（複数のセレクタを試す）
            let usernameInput = document.querySelector('input[autocomplete="username"], input[name="text"], input[type="text"][data-testid*="ocfEnterTextTextInput"]');
            
            if (!usernameInput) {
              // 少し待ってから再試行
              await new Promise(r => setTimeout(r, 1000));
              usernameInput = document.querySelector('input[autocomplete="username"], input[name="text"], input[type="text"][data-testid*="ocfEnterTextTextInput"]');
            }
            
            if (!usernameInput) {
              return { 
                didAction: false, 
                reason: 'ユーザー名入力欄が見つかりませんでした'
              };
            }
            
            // 入力欄をフォーカスしてクリック
            (usernameInput as HTMLInputElement).focus();
            (usernameInput as HTMLInputElement).click();
            await new Promise(r => setTimeout(r, 500));
            
            // 既存の値をクリア
            (usernameInput as HTMLInputElement).value = '';
            (usernameInput as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
            
            // ユーザー名を1文字ずつ入力
            for (let i = 0; i < username.length; i++) {
              const char = username[i];
              (usernameInput as HTMLInputElement).value += char;
              (usernameInput as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: char }));
              (usernameInput as HTMLInputElement).dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: char }));
              (usernameInput as HTMLInputElement).dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: char }));
              (usernameInput as HTMLInputElement).dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise(r => setTimeout(r, 50));
            }
            
            await new Promise(r => setTimeout(r, 500));
            (usernameInput as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true }));
            
            return { 
              didAction: true, 
              reason: 'ユーザー名を入力しました',
              enteredUsername: (usernameInput as HTMLInputElement).value
            };
          } catch (e) {
            return { 
              didAction: false, 
              reason: 'ユーザー名入力中にエラーが発生しました: ' + String(e)
            };
          }
        })()
      `,
      postWaitSeconds: 2
    },
    {
      type: 'eval',
      description: '次へボタンをクリック',
      code: `
        (async () => {
          try {
            // 次へボタンを探す（複数のセレクタを試す）
            let nextButton = Array.from(document.querySelectorAll('button[role="button"], div[role="button"]'))
              .find(btn => {
                const text = btn.textContent || '';
                return text.includes('次へ') || text.includes('Next') || text.includes('続ける');
              });
            
            if (!nextButton) {
              // data-testidで探す
              nextButton = document.querySelector('button[data-testid*="ocfEnterTextNextButton"], button[data-testid*="next"]') as HTMLElement;
            }
            
            if (!nextButton) {
              await new Promise(r => setTimeout(r, 1000));
              nextButton = Array.from(document.querySelectorAll('button[role="button"], div[role="button"]'))
                .find(btn => {
                  const text = btn.textContent || '';
                  return text.includes('次へ') || text.includes('Next') || text.includes('続ける');
                }) as HTMLElement;
            }
            
            if (!nextButton) {
              return { 
                didAction: false, 
                reason: '次へボタンが見つかりませんでした'
              };
            }
            
            (nextButton as HTMLElement).click();
            await new Promise(r => setTimeout(r, 2000));
            
            return { 
              didAction: true, 
              reason: '次へボタンをクリックしました'
            };
          } catch (e) {
            return { 
              didAction: false, 
              reason: '次へボタンクリック中にエラーが発生しました: ' + String(e)
            };
          }
        })()
      `,
      postWaitSeconds: 3
    },
    {
      type: 'eval',
      description: 'パスワードを入力',
      code: `
        (async () => {
          try {
            const password = '{{x_password}}';
            
            if (!password || password.trim() === '') {
              return { 
                didAction: false, 
                reason: 'x_password が指定されていません。テンプレート変数 {{x_password}} を指定してください'
              };
            }
            
            // パスワード入力欄を探す
            let passwordInput = document.querySelector('input[type="password"], input[name="password"], input[autocomplete="current-password"]') as HTMLInputElement;
            
            if (!passwordInput) {
              await new Promise(r => setTimeout(r, 1000));
              passwordInput = document.querySelector('input[type="password"], input[name="password"], input[autocomplete="current-password"]') as HTMLInputElement;
            }
            
            if (!passwordInput) {
              return { 
                didAction: false, 
                reason: 'パスワード入力欄が見つかりませんでした'
              };
            }
            
            // 入力欄をフォーカスしてクリック
            passwordInput.focus();
            passwordInput.click();
            await new Promise(r => setTimeout(r, 500));
            
            // 既存の値をクリア
            passwordInput.value = '';
            passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
            
            // パスワードを1文字ずつ入力
            for (let i = 0; i < password.length; i++) {
              const char = password[i];
              passwordInput.value += char;
              passwordInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: char }));
              passwordInput.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: char }));
              passwordInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: char }));
              passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise(r => setTimeout(r, 50));
            }
            
            await new Promise(r => setTimeout(r, 500));
            passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
            
            return { 
              didAction: true, 
              reason: 'パスワードを入力しました'
            };
          } catch (e) {
            return { 
              didAction: false, 
              reason: 'パスワード入力中にエラーが発生しました: ' + String(e)
            };
          }
        })()
      `,
      postWaitSeconds: 2
    },
    {
      type: 'eval',
      description: 'ログインボタンをクリック',
      code: `
        (async () => {
          try {
            // ログインボタンを探す
            let loginButton = Array.from(document.querySelectorAll('button[role="button"], div[role="button"]'))
              .find(btn => {
                const text = btn.textContent || '';
                return text.includes('ログイン') || text.includes('Log in') || text.includes('Sign in');
              }) as HTMLElement;
            
            if (!loginButton) {
              loginButton = document.querySelector('button[data-testid*="Login"], button[data-testid*="login"]') as HTMLElement;
            }
            
            if (!loginButton) {
              await new Promise(r => setTimeout(r, 1000));
              loginButton = Array.from(document.querySelectorAll('button[role="button"], div[role="button"]'))
                .find(btn => {
                  const text = btn.textContent || '';
                  return text.includes('ログイン') || text.includes('Log in') || text.includes('Sign in');
                }) as HTMLElement;
            }
            
            if (!loginButton) {
              return { 
                didAction: false, 
                reason: 'ログインボタンが見つかりませんでした'
              };
            }
            
            (loginButton as HTMLElement).click();
            await new Promise(r => setTimeout(r, 3000));
            
            return { 
              didAction: true, 
              reason: 'ログインボタンをクリックしました'
            };
          } catch (e) {
            return { 
              didAction: false, 
              reason: 'ログインボタンクリック中にエラーが発生しました: ' + String(e)
            };
          }
        })()
      `,
      postWaitSeconds: 5
    },
    {
      type: 'eval',
      description: '2FAコードを入力（必要な場合）',
      code: `
        (async () => {
          try {
            const twofaCode = '{{twofa_code}}';
            
            // 2FAコードが指定されていない場合はスキップ
            if (!twofaCode || twofaCode.trim() === '') {
              return { 
                didAction: true, 
                reason: '2FAコードが指定されていないためスキップしました',
                skipped: true
              };
            }
            
            // 2FA入力欄を探す
            let twofaInput = document.querySelector('input[type="text"][data-testid*="ocfEnterTextTextInput"], input[name="text"], input[autocomplete="one-time-code"]') as HTMLInputElement;
            
            if (!twofaInput) {
              await new Promise(r => setTimeout(r, 2000));
              twofaInput = document.querySelector('input[type="text"][data-testid*="ocfEnterTextTextInput"], input[name="text"], input[autocomplete="one-time-code"]') as HTMLInputElement;
            }
            
            // 2FA入力欄が見つからない場合は、2FAが不要と判断
            if (!twofaInput) {
              return { 
                didAction: true, 
                reason: '2FA入力欄が見つかりませんでした（2FAが不要の可能性があります）',
                skipped: true
              };
            }
            
            // 入力欄をフォーカスしてクリック
            twofaInput.focus();
            twofaInput.click();
            await new Promise(r => setTimeout(r, 500));
            
            // 既存の値をクリア
            twofaInput.value = '';
            twofaInput.dispatchEvent(new Event('input', { bubbles: true }));
            
            // 2FAコードを入力
            for (let i = 0; i < twofaCode.length; i++) {
              const char = twofaCode[i];
              twofaInput.value += char;
              twofaInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: char }));
              twofaInput.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: char }));
              twofaInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: char }));
              twofaInput.dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise(r => setTimeout(r, 50));
            }
            
            await new Promise(r => setTimeout(r, 500));
            twofaInput.dispatchEvent(new Event('change', { bubbles: true }));
            
            // 次へボタンをクリック
            await new Promise(r => setTimeout(r, 1000));
            let nextButton = Array.from(document.querySelectorAll('button[role="button"], div[role="button"]'))
              .find(btn => {
                const text = btn.textContent || '';
                return text.includes('次へ') || text.includes('Next') || text.includes('続ける');
              }) as HTMLElement;
            
            if (nextButton) {
              (nextButton as HTMLElement).click();
              await new Promise(r => setTimeout(r, 2000));
            }
            
            return { 
              didAction: true, 
              reason: '2FAコードを入力しました'
            };
          } catch (e) {
            return { 
              didAction: false, 
              reason: '2FAコード入力中にエラーが発生しました: ' + String(e)
            };
          }
        })()
      `,
      postWaitSeconds: 3
    },
    {
      type: 'navigate',
      description: 'Xのホームページに移動',
      url: 'https://x.com/home',
      expected: {
        urlContains: 'x.com'
      },
      postWaitSeconds: 3
    },
    {
      type: 'eval',
      description: 'ログイン状態を確認',
      code: `
        (async () => {
          try {
            // ログインボタンの存在を確認（ログインしていない場合に表示される）
            const loginButtons = Array.from(document.querySelectorAll('a[href*="/i/flow/login"], button[data-testid*="login"]'));
            const hasLoginButton = loginButtons.length > 0;
            
            // ユーザー名やプロフィール要素の存在を確認（ログインしている場合に表示される）
            const userElements = Array.from(document.querySelectorAll('[data-testid="SideNav_AccountSwitcher_Button"], [data-testid="AppTabBar_Profile_Link"]'));
            const hasUserElement = userElements.length > 0;
            
            // ログイン状態の判定
            const isLoggedIn = !hasLoginButton && hasUserElement;
            
            if (isLoggedIn) {
              return { 
                didAction: true, 
                reason: 'ログイン状態を確認しました',
                hasLoginButton: false,
                hasUserElement: true
              };
            } else {
              // ログインしていない場合、URLを確認
              const currentUrl = window.location.href;
              const isLoginPage = currentUrl.includes('/i/flow/login') || currentUrl.includes('/login');
              
              if (isLoginPage) {
                return { 
                  didAction: false, 
                  reason: 'ログインページが表示されています。ログインに失敗した可能性があります',
                  currentUrl: currentUrl
                };
              } else {
                return { 
                  didAction: false, 
                  reason: 'ログイン状態を確認できませんでした',
                  hasLoginButton: hasLoginButton,
                  hasUserElement: hasUserElement,
                  currentUrl: currentUrl
                };
              }
            }
          } catch (e) {
            return { 
              didAction: false, 
              reason: 'ログイン状態確認中にエラーが発生しました: ' + String(e)
            };
          }
        })()
      `,
      postWaitSeconds: 2
    }
  ];

  try {
    const result = createPreset(presetName, presetDescription, JSON.stringify(steps));
    console.log(`✅ プリセットを作成しました:`);
    console.log(`   ID: ${result.id}`);
    console.log(`   名前: ${presetName}`);
    console.log(`   説明: ${presetDescription}`);
    console.log(`   ステップ数: ${steps.length}`);
    console.log(`\n使用方法:`);
    console.log(`   1. ダッシュボードでプリセット一覧を確認`);
    console.log(`   2. プリセット実行時にテンプレート変数を指定:`);
    console.log(`      - {{container_name}}: コンテナ名（必須、新規作成される）`);
    console.log(`      - {{x_username}}: Xユーザー名（必須）`);
    console.log(`      - {{x_password}}: パスワード（必須）`);
    console.log(`      - {{twofa_code}}: 2FAコード（オプション）`);
    console.log(`   3. プリセットを実行（コンテナを作成/開く→ログイン→ログイン状態を確認）`);
    console.log(`\n注意:`);
    console.log(`   - container_name が指定されている場合、プリセット実行時に指定されている containerId は無視されます`);
    console.log(`   - コンテナは自動的に作成/開かれます`);
  } catch (e: any) {
    console.error('❌ プリセット作成に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

