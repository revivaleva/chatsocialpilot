
import { evalInContext, closeContainer } from '../src/drivers/browser.js';
import { fetchVerificationCode } from '../src/services/emailFetcher.js';

async function main() {
    const cid = '130fc70c-bd57-436c-babe-efd00f9a54b6';
    const email = "jokle6gs@gmx.com";
    const password = "xu3cIU48d";

    console.log(`Fetching verification code for ${email} (GMX)...`);
    const emailRes = await fetchVerificationCode({
        email,
        email_password: password,
        timeout_seconds: 180
    });

    if (emailRes.ok && emailRes.code) {
        console.log(`Code received: ${emailRes.code}. Submitting...`);
        const submitCode = await evalInContext(cid, `(function() {
            const input = document.querySelector('input[name="token"]');
            if (input) {
                input.value = '${emailRes.code}';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                const btn = Array.from(document.querySelectorAll('input[type="submit"], button')).find(b => b.value === 'Verify' || b.innerText.includes('Verify'));
                if (btn) {
                    btn.click();
                    return { ok: true, msg: 'Submitted' };
                }
                return { ok: false, msg: 'Submit button not found' };
            }
            return { ok: false, msg: 'Input[name="token"] not found' };
        })()`);
        console.log('Submit result:', JSON.stringify(submitCode.result, null, 2));

        console.log('Waiting for final result...');
        await new Promise(r => setTimeout(r, 10000));

        const check = await evalInContext(cid, `(function() {
            const url = window.location.href;
            if (url.includes('/home')) return { status: 'success', url };
            if (document.body.innerText.includes('セキュリティ検証') || document.body.innerText.includes('Cloudflare')) return { status: 'cloudflare_again', url };
            return { status: 'unknown', url, text: document.body.innerText.slice(0, 100) };
        })()`);
        console.log('Final Result:', JSON.stringify(check.result, null, 2));

        if (check.result?.status === 'success') {
            console.log('Restore SUCCESS. Closing container.');
            await closeContainer({ id: cid });
        }
    } else {
        console.error('Email code not received. Stopping recovery for this account.');
    }
}

main().catch(console.error);
