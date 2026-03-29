import fs from "fs";
const path = "presets/follower-count-only.json";
const data = JSON.parse(fs.readFileSync(path, "utf-8"));

data.steps[1].code = `(function() {
  try {
    const bodyText = document.body.textContent || '';
    // アカウント凍結の明示的な文言チェック
    const isSuspended = bodyText.includes('Your account is suspended') || 
                        bodyText.includes('アカウントは凍結されています') ||
                        (bodyText.includes('suspended') && bodyText.includes('account'));
    
    if (isSuspended) {
      return {
        ok: false,
        error: 'アカウントが凍結されています',
        didAction: false,
        suspended: true
      };
    }

    // ログインページ検出（ログアウト状態）
    const loginButton = document.querySelector('[data-testid=\"login\"]');
    const signupButton = document.querySelector('[data-testid=\"signup\"]');
    const landingText1 = bodyText.includes('いま起きていることを見つけよう');
    const landingText2 = bodyText.includes('Xなら、「いま」起きていることをいち早くチェックできます。');
    
    if (loginButton || signupButton || (landingText1 && landingText2)) {
      return {
        ok: false,
        error: 'ログアウト状態です（ログインページが表示されています）',
        didAction: false,
        logged_out: true
      };
    }
    
    // フォロワー数とフォロー数のリンクを探す
    let followerLink = document.querySelector('a[href*=\"/verified_followers\"]') || document.querySelector('a[href*=\"/followers\"]');
    let followingLink = document.querySelector('a[href*=\"/following\"]');
    
    const profileHeader = document.querySelector('[data-testid=\"UserProfileHeader_Items\"]') || 
                         document.querySelector('[data-testid=\"UserName\"]')?.closest('div')?.parentElement;
    
    if (profileHeader) {
      if (!followerLink) followerLink = profileHeader.querySelector('a[href*=\"/followers\"], a[href*=\"/verified_followers\"]');
      if (!followingLink) followingLink = profileHeader.querySelector('a[href*=\"/following\"]');
    }
    
    let followerCount = null, followingCount = null;
    
    if (followerLink) {
      const match = (followerLink.textContent || '').match(/([\\d,]+)/);
      if (match) followerCount = parseInt(match[1].replace(/,/g, ''), 10);
    }
    if (followingLink) {
      const match = (followingLink.textContent || '').match(/([\\d,]+)/);
      if (match) followingCount = parseInt(match[1].replace(/,/g, ''), 10);
    }
    
    if (profileHeader && (followerCount === null || followingCount === null)) {
      const ht = profileHeader.textContent || '';
      if (followerCount === null) {
        const fm = ht.match(/([\\d,]+)\\s*(フォロワー|Followers|follower)/i);
        if (fm) followerCount = parseInt(fm[1].replace(/,/g, ''), 10);
      }
      if (followingCount === null) {
        const fm = ht.match(/([\\d,]+)\\s*(フォロー|Following)/i);
        if (fm) followingCount = parseInt(fm[1].replace(/,/g, ''), 10);
      }
    }
    
    if (followerCount !== null || followingCount !== null) {
      return { 
        ok: true, 
        followerCount,
        followingCount,
        didAction: true,
        reason: 'フォロワー数: ' + (followerCount !== null ? followerCount : '取得失敗') + ', フォロー数: ' + (followingCount !== null ? followingCount : '取得失敗')
      };
    }
    
    return { ok: false, error: 'フォロワー数またはフォロー数が見つかりませんでした', didAction: false };
  } catch (e) {
    return { ok: false, error: 'エラー: ' + (e.message || String(e)), didAction: false };
  }
})()`;

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log("Updated presets/follower-count-only.json");
