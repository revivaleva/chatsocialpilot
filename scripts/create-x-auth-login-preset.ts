/**
 * XのAuthトークンログインプリセットを作成するスクリプト
 * 
 * 使用方法:
 *   npm run ts-node scripts/create-x-auth-login-preset.ts
 * 
 * または:
 *   npx tsx scripts/create-x-auth-login-preset.ts
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { createPreset } from '../src/services/presets';

async function main() {
  // DBを初期化
  initDb({ wal: true });
  
  const presetName = 'X Authログイン';
  const presetDescription = 'X（旧Twitter）にAuthトークンでログインします。テンプレート変数 {{container_name}}（コンテナ名、必須）、{{auth_token}}（認証トークン、必須）、{{ct0}}（CSRFトークン、必須）を指定してコンテナを作成/開き、Cookieを設定してログイン状態を確認します。';

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
      description: 'Xのドメインに移動（Cookie設定のため）',
      url: 'https://x.com',
      expected: {
        urlContains: 'x.com'
      },
      postWaitSeconds: 2
    },
    {
      type: 'eval',
      description: 'AuthトークンとCSRFトークンをCookieとして設定',
      code: `
        (async () => {
          try {
            // テンプレート変数からトークンを取得
            const authToken = '{{auth_token}}';
            const ct0 = '{{ct0}}';
            
            // 必須パラメータのチェック（テンプレート変数が置換されていない場合のみエラー）
            // 置換後は値が入るので、空文字列またはテンプレート変数文字列のままの場合のみエラー
            // 注意: テンプレート変数の置換処理が '{{auth_token}}' も置換してしまうため、
            // 文字列リテラル内の '{{auth_token}}' は置換されないようにする必要がある
            // 解決策: テンプレート変数文字列のチェックを削除し、空文字列チェックのみにする
            if (!authToken || authToken.trim() === '') {
              return { 
                didAction: false, 
                reason: 'auth_token が指定されていません。テンプレート変数 {{auth_token}} を指定してください'
              };
            }
            if (!ct0 || ct0.trim() === '') {
              return { 
                didAction: false, 
                reason: 'ct0 が指定されていません。テンプレート変数 {{ct0}} を指定してください'
              };
            }
            
            // Cookieを設定
            // Xの認証に必要な主要Cookie
            const domain = '.x.com';
            const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString(); // 1年後
            
            // auth_token を設定
            document.cookie = \`auth_token=\${authToken}; domain=\${domain}; path=/; expires=\${expires}; SameSite=None; Secure\`;
            
            // ct0 (CSRFトークン) を設定
            document.cookie = \`ct0=\${ct0}; domain=\${domain}; path=/; expires=\${expires}; SameSite=Lax; Secure\`;
            
            // その他のセッションCookie（オプション）
            // guest_id なども設定できるが、必須ではない
            
            // 設定確認
            const cookies = document.cookie;
            const hasAuthToken = cookies.includes('auth_token=');
            const hasCt0 = cookies.includes('ct0=');
            
            if (hasAuthToken && hasCt0) {
              return { 
                didAction: true, 
                reason: 'Cookieを設定しました',
                cookiesSet: { auth_token: hasAuthToken, ct0: hasCt0 }
              };
            } else {
              return { 
                didAction: false, 
                reason: 'Cookieの設定に失敗しました',
                cookiesSet: { auth_token: hasAuthToken, ct0: hasCt0 }
              };
            }
          } catch (e) {
            return { 
              didAction: false, 
              reason: 'Cookie設定中にエラーが発生しました: ' + String(e)
            };
          }
        })()
      `,
      postWaitSeconds: 1
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
      description: 'ログイン状態を確認（ログインボタンがない、またはユーザー名が表示されているか）',
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
                  reason: 'ログインページが表示されています。Authトークンが無効または期限切れの可能性があります',
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
    console.log(`      - {{auth_token}}: Xの認証トークン（必須）`);
    console.log(`      - {{ct0}}: CSRFトークン（必須）`);
    console.log(`   3. プリセットを実行（コンテナを作成/開く→トークンをセット→Xにアクセス→ログイン状態を確認）`);
    console.log(`\n注意:`);
    console.log(`   - container_name が指定されている場合、プリセット実行時に指定されている containerId は無視されます`);
    console.log(`   - コンテナは自動的に作成/開かれます`);
    console.log(`\n実行例（API経由）:`);
    console.log(`   POST /api/presets/${result.id}/run-with-overrides`);
    console.log(`   {`);
    console.log(`     "containerId": "ignored-if-container_name-specified",`);
    console.log(`     "overrides": {`);
    console.log(`       "container_name": "my-x-container",`);
    console.log(`       "auth_token": "your-auth-token-here",`);
    console.log(`       "ct0": "your-csrf-token-here"`);
    console.log(`     }`);
    console.log(`   }`);
  } catch (e: any) {
    console.error('❌ プリセット作成に失敗しました:', e);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});

