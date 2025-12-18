import { initDb } from '../src/drivers/db';
import { getPreset, updatePreset } from '../src/services/presets';

initDb({ wal: true });

// プリセットID 29（フォロワー数取得・保存）を取得
const preset = getPreset(29);
if (!preset) {
  console.error('❌ プリセット ID 29 が見つかりません');
  process.exit(1);
}

const steps = JSON.parse(preset.steps_json || '[]');
console.log('現在のステップ数:', steps.length);

// ステップ2（インデックス1）のevalコードを更新
if (steps.length < 2 || steps[1].type !== 'eval') {
  console.error('❌ ステップ2がevalタイプではありません');
  process.exit(1);
}

// アカウント凍結検出ロジックを追加したコード
const updatedCode = `(function() {
      try {
        // アカウント凍結検出: ログインページが表示されているかチェック
        const loginButton = document.querySelector('[data-testid="login"]');
        const signupButton = document.querySelector('[data-testid="signup"]');
        const suspendedText1 = document.body.textContent?.includes('いま起きていることを見つけよう');
        const suspendedText2 = document.body.textContent?.includes('Xなら、「いま」起きていることをいち早くチェックできます。');
        
        // 凍結検出条件: ログインボタンまたは特定のテキストが存在する
        if (loginButton || (suspendedText1 && suspendedText2)) {
          return {
            ok: false,
            error: 'アカウントが凍結されている可能性があります（ログインページが表示されています）',
            didAction: false,
            suspended: true
          };
        }
        
        // フォロワー数とフォロー数のリンクを探す
        let followerLink = document.querySelector('a[href*="/verified_followers"]');
        let followingLink = document.querySelector('a[href*="/following"]');
        
        // パターン2: 通常のfollowers/followingリンク
        if (!followerLink) {
          followerLink = document.querySelector('a[href*="/followers"]');
        }
        if (!followingLink) {
          followingLink = document.querySelector('a[href*="/following"]');
        }
        
        // パターン3: プロフィールヘッダー内を探す
        const profileHeader = document.querySelector('[data-testid="UserProfileHeader_Items"]') || 
                             document.querySelector('[data-testid="UserName"]')?.closest('div')?.parentElement;
        
        if (profileHeader) {
          if (!followerLink) {
            followerLink = profileHeader.querySelector('a[href*="/followers"], a[href*="/verified_followers"]');
          }
          if (!followingLink) {
            followingLink = profileHeader.querySelector('a[href*="/following"]');
          }
        }
        
        let followerCount = null;
        let followingCount = null;
        
        // フォロワー数を取得
        if (followerLink) {
          const linkText = followerLink.textContent || followerLink.innerText || '';
          // 数値とカンマを含むパターンを探す（例: "1" や "1,234"）
          const match = linkText.match(/([\\d,]+)/);
          if (match) {
            followerCount = parseInt(match[1].replace(/,/g, ''), 10);
          }
        }
        
        // フォロー数を取得
        if (followingLink) {
          const linkText = followingLink.textContent || followingLink.innerText || '';
          // 数値とカンマを含むパターンを探す（例: "5" や "5,678"）
          const match = linkText.match(/([\\d,]+)/);
          if (match) {
            followingCount = parseInt(match[1].replace(/,/g, ''), 10);
          }
        }
        
        // パターン4: プロフィールヘッダー内のテキストから直接取得
        if (profileHeader && (followerCount === null || followingCount === null)) {
          const headerText = profileHeader.textContent || '';
          // フォロワー数を探す
          if (followerCount === null) {
            const followerMatch = headerText.match(/([\\d,]+)\\s*(フォロワー|Followers|follower)/i);
            if (followerMatch) {
              followerCount = parseInt(followerMatch[1].replace(/,/g, ''), 10);
            }
          }
          // フォロー数を探す
          if (followingCount === null) {
            const followingMatch = headerText.match(/([\\d,]+)\\s*(フォロー|Following)/i);
            if (followingMatch) {
              followingCount = parseInt(followingMatch[1].replace(/,/g, ''), 10);
            }
          }
        }
        
        if (followerCount !== null || followingCount !== null) {
          return { 
            ok: true, 
            followerCount: followerCount,
            followingCount: followingCount,
            didAction: true,
            reason: 'フォロワー数: ' + (followerCount !== null ? followerCount : '取得失敗') + ', フォロー数: ' + (followingCount !== null ? followingCount : '取得失敗')
          };
        }
        
        return { 
          ok: false, 
          error: 'フォロワー数またはフォロー数が見つかりませんでした',
          didAction: false
        };
      } catch (e) {
        return {
          ok: false,
          error: 'エラーが発生しました: ' + (e.message || String(e)),
          didAction: false
        };
      }
    })()`;

// ステップ2のコードを更新
steps[1].code = updatedCode;

// プリセットを更新
updatePreset(preset.id, preset.name, preset.description || '', JSON.stringify(steps));

console.log('✅ プリセットID 29のステップ2にアカウント凍結検出機能を追加しました');

