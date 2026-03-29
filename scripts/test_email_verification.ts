
import { initDb, query } from '../src/drivers/db.js';
import { evalInContext, execInContainer, closeContainer } from '../src/drivers/browser.js';
import { fetchVerificationCode } from '../src/services/emailFetcher.js';

async function main() {
    initDb();
    const xid = 'lisa9tk6t9c';

    // 1. Get account data
    const accRows = query("SELECT * FROM x_accounts WHERE container_id = ?", [xid]) as any[];
    if (accRows.length === 0) return console.error(`Account ${xid} not found`);
    const acc = accRows[0];

    const containerId = '61140465-36cd-494c-9916-56665e7fa459'; // Provided by previous log

    console.log(`Handling verification for ${xid}...`);

    // 2. Click "Send Email" (if not already clicked)
    const clickRes = await evalInContext(containerId, `(function() {
        const btn = Array.from(document.querySelectorAll('input[type="submit"], button')).find(b => b.value === 'メールを送信する' || b.innerText.includes('メールを送信'));
        if (btn) {
            btn.click();
            return { clicked: true };
        }
        return { clicked: false, msg: 'Button not found' };
    })()`);
    console.log('Click result:', clickRes.result);

    if (clickRes.result?.clicked) {
        console.log('Waiting 10 seconds for email to be sent...');
        await new Promise(r => setTimeout(r, 10000));
    }

    // 3. Keep checking for input area
    const checkInput = await evalInContext(containerId, `(function() {
        const input = document.querySelector('input[name="code"]');
        return !!input;
    })()`);

    if (!checkInput.result) {
        console.log('Input field for code not found yet. Refreshing?');
        // Sometimes it takes time.
    }

    // 4. Fetch verification code
    console.log('Fetching verification code from email...');
    const emailRes = await fetchVerificationCode({
        email: acc.email,
        email_password: acc.email_password.includes(':') ? acc.email_password.split(':')[1] : acc.email_password,
        timeout_seconds: 120 // Wait up to 2 mins
    });

    console.log('Email result:', JSON.stringify(emailRes, null, 2));

    if (emailRes.ok && emailRes.code) {
        console.log(`Found code: ${emailRes.code}. Injecting...`);
        const inputRes = await evalInContext(containerId, `(function() {
            const input = document.querySelector('input[name="code"]');
            if (input) {
                input.value = '${emailRes.code}';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                const btn = Array.from(document.querySelectorAll('input[type="submit"], button')).find(b => b.value === '送信' || b.innerText.includes('Next') || b.innerText.includes('次へ') || b.innerText.includes('確認'));
                if (btn) btn.click();
                return { ok: true };
            }
            return { ok: false };
        })()`);
        console.log('Injection result:', inputRes.result);

        await new Promise(r => setTimeout(r, 8000));

        const finalCheck = await evalInContext(containerId, `(function() {
            const url = window.location.href;
            if (url.includes('/home')) return 'active';
            return 'still_locked';
        })()`);
        console.log('Final status:', finalCheck.result);

        if (finalCheck.result === 'active') {
            await closeContainer({ id: containerId });
            console.log('Restore SUCCESS. Container closed.');
        }
    } else {
        console.error('Failed to fetch code or no code arrived.');
    }
}

main().catch(console.error);
