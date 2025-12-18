/**
 * X（Twitter）メールアドレス変更プリセットを作成するスクリプト
 * 
 * 使用方法:
 *   npx tsx scripts/create-x-change-email-preset.ts
 * 
 * このプリセットはX（Twitter）のメールアドレス変更を自動化します。
 * アカウントテーブルからパスワードを取得する必要があります。
 */

import 'dotenv/config';
import { initDb } from '../src/drivers/db';
import { createPreset } from '../src/services/presets';

async function main() {
  // DBを初期化
  initDb({ wal: true });
  
  const presetName = 'Xメールアドレス変更';
  const presetDescription = 'X（Twitter）のメールアドレスを変更するプリセットです。アカウントテーブルからパスワードを取得し、新しいメールアドレスに変更します。テンプレート変数 {{new_email}}（新しいメールアドレス、必須）、{{email}}（メール取得用メールアドレス、必須）、{{email_password}}（メール取得用パスワード、必須）を指定します。';

  // プリセットステップ定義
  const steps = [
    {
      type: 'navigate',
      description: 'Xのアカウント設定ページにアクセス',
      url: 'https://x.com/settings/your_twitter_data/account',
      postWaitSeconds: 3
    },
    {
      type: 'type',
      description: 'パスワードを入力（アカウントテーブルから取得）',
      selector: 'input[name="current_password"][type="password"]',
      text: '{{account_password}}',
      postWaitSeconds: 2
    },
    {
      type: 'click',
      description: 'Confirmボタンをクリック',
      selector: 'button[role="button"]',
      text: 'Confirm',
      postWaitSeconds: 3
    },
    {
      type: 'click',
      description: 'メールアドレス欄をクリック',
      selector: 'button, a, [role="button"], div[role="button"]',
      text: 'email',
      postWaitSeconds: 2
    },
    {
      type: 'click',
      description: 'Update email addressボタンをクリック',
      selector: 'button, [role="button"]',
      text: 'Update email address',
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
      type: 'click',
      description: 'Nextボタンをクリック（表示確認後）',
      selector: 'button, [role="button"]',
      text: 'Next',
      postWaitSeconds: 5
    },
    {
      type: 'fetch_email',
      description: 'メールから確認コード（6桁の数字）を取得',
      email: '{{email}}',
      email_password: '{{email_password}}',
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
      type: 'click',
      description: 'Verifyボタンをクリック',
      selector: 'button, [role="button"]',
      text: 'Verify',
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
    const result = createPreset(presetName, presetDescription, JSON.stringify(steps));
    console.log(`✅ プリセットを作成しました:`);
    console.log(`   ID: ${result.id}`);
    console.log(`   名前: ${presetName}`);
    console.log(`   説明: ${presetDescription}`);
    console.log(`   ステップ数: ${steps.length}`);
    console.log(`\nテンプレート変数（必須）:`);
    console.log(`   - {{account_password}}: Xアカウントのパスワード（アカウントテーブルから取得）`);
    console.log(`   - {{new_email}}: 新しいメールアドレス`);
    console.log(`   - {{email}}: メール取得用メールアドレス（FirstMail用）`);
    console.log(`   - {{email_password}}: メール取得用パスワード（FirstMail用）`);
    console.log(`\n自動設定される変数:`);
    console.log(`   - {{verification_code}}: 取得した確認コード（fetch_emailステップで自動設定）`);
    console.log(`\nステップ一覧:`);
    steps.forEach((step, index) => {
      console.log(`   ${index + 1}. ${step.description || step.type}`);
    });
    console.log(`\n注意事項:`);
    console.log(`   - アカウントテーブルにパスワードデータが必要です`);
    console.log(`   - 各ステップのセレクターは実際のHTMLに合わせて調整が必要です`);
    console.log(`   - エラーメッセージの検出ロジックは改善の余地があります`);
    console.log(`\n実行例（API経由）:`);
    console.log(`   POST /api/presets/${result.id}/run-with-overrides`);
    console.log(`   {`);
    console.log(`     "containerId": "コンテナID",`);
    console.log(`     "overrides": {`);
    console.log(`       "account_password": "Xアカウントのパスワード",`);
    console.log(`       "new_email": "new@example.com",`);
    console.log(`       "email": "email@estabamail.com",`);
    console.log(`       "email_password": "email-password"`);
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
