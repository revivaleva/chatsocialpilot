
import { execInContainer, evalInContext } from '../src/drivers/browser.js';
import { fetchVerificationCode } from '../src/services/emailFetcher.js';
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const xid = 'SBneder60540';
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    const acc = (query('SELECT * FROM x_accounts WHERE container_id = ?', [xid]) as any[])[0];

    // 1. Click Start
    console.log('Step 1: Clicking "Start"...');
    await evalInContext(cid, `
        (function() {
            const btn = document.querySelector('input[type="submit"][value="Start"]');
            if (btn) btn.click();
        })()
    `);
    await new Promise(r => setTimeout(r, 8000));

    // 2. Click "Next" / "Send email"
    console.log('Step 2: Clicking "Next/Send email"...');
    const sendRes = await evalInContext(cid, `
        (function() {
            const btn = Array.from(document.querySelectorAll('div[role="button"], input[type="submit"], span, button'))
                .find(el => el.innerText?.includes('Next') || el.innerText?.includes('Send email') || el.innerText?.includes('次へ') || el.innerText?.includes('メールを送信'));
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        })()
    `);

    if (sendRes.result) {
        console.log('  Send button clicked. Waiting 30s for email...');
        await new Promise(r => setTimeout(r, 30000));
    } else {
        console.log('  Send/Next button NOT found. Maybe code input is already there?');
    }

    // 3. Fetch Verification Code
    console.log(`Step 3: Fetching code for ${acc.email}...`);
    const emailRes = await fetchVerificationCode({
        email: acc.email,
        email_password: acc.email_password,
        timeout_seconds: 60
    });

    if (!emailRes.ok || !emailRes.code) {
        console.error('  Failed to fetch code:', emailRes.error, emailRes.message);
        return;
    }
    const code = emailRes.code;
    console.log('  Got code:', code);

    // 4. Input Code and Submit
    console.log('Step 4: Inputting code and submitting...');
    await evalInContext(cid, `
        (function() {
            const input = document.querySelector('input[name="verfication_code"], input[placeholder*="code"], input[placeholder*="コード"]');
            if (input) {
                input.value = '${code}';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                
                setTimeout(() => {
                    const verifyBtn = Array.from(document.querySelectorAll('div[role="button"], input[type="submit"], span, button'))
                        .find(el => el.innerText?.includes('Verify') || el.innerText?.includes('Submit') || el.innerText?.includes('認証') || el.innerText?.includes('送信'));
                    if (verifyBtn) verifyBtn.click();
                }, 500);
                return true;
            }
            return false;
        })()
    `);

    console.log('Step 5: Process complete. Waiting 10s for stability...');
    await new Promise(r => setTimeout(r, 10000));

    // Final result
    const url = await evalInContext(cid, 'window.location.href');
    const title = await evalInContext(cid, 'document.title');
    console.log('Final URL:', url.result);
    console.log('Final Title:', title.result);
}

main().catch(console.error);
