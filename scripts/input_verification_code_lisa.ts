
import { evalInContext, closeContainer } from '../src/drivers/browser.js';
import { fetchVerificationCode } from '../src/services/emailFetcher.js';

async function main() {
    const cid = '3b51b016-3ffd-46e1-807d-23acc5573c9b';
    const email = "josejackson2022@quieresmail.com";
    const password = "qzgoyxiwA7014";

    console.log(`Fetching verification code for ${email}...`);
    const emailRes = await fetchVerificationCode({
        email,
        email_password: password,
        timeout_seconds: 180 // Wait up to 3 mins
    });

    if (emailRes.ok && emailRes.code) {
        console.log(`Code received: ${emailRes.code}. Submitting...`);
        const submitCode = await evalInContext(cid, `(function() {
            const input = document.querySelector('input[name="token"]');
            if (input) {
                input.value = '${emailRes.code}';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                const btn = Array.from(document.querySelectorAll('input[type="submit"], button')).find(b => b.value === '認証する' || b.innerText.includes('認証') || b.innerText.includes('Confirm'));
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

        const finalUrl = await evalInContext(cid, 'window.location.href');
        console.log('Final URL:', finalUrl.result);

        if (finalUrl.result.includes('/home')) {
            console.log('Restore SUCCESS. Closing container.');
            await closeContainer({ id: cid });
        } else {
            console.log(`Still on ${finalUrl.result}. Check screenshots or body.`);
        }
    } else {
        console.error('Email code not received. Stopping recovery for this account.');
    }
}

main().catch(console.error);
