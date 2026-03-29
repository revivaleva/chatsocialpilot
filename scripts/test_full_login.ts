
import { initDb, query } from '../src/drivers/db.js';
import { evalInContext, createContainer, execInContainer } from '../src/drivers/browser.js';
import { generateTOTPCode } from '../src/services/totpGenerator.js';

async function main() {
    initDb();
    const xid = 'SurferAstr17144'; // Test candidate (has 2FA)

    // Get account data
    const accRows = query("SELECT * FROM x_accounts WHERE container_id = ?", [xid]) as any[];
    if (accRows.length === 0) {
        console.error(`Account not found for ${xid}`);
        return;
    }
    const acc = accRows[0];

    console.log(`Testing FULL login (ID/Pass/2FA) for ${xid}...`);

    // 1. Create/Ensure container (Use proxy if available)
    let proxyOpts = undefined;
    if (acc.proxy_id) {
        const proxyRows = query("SELECT proxy_info FROM proxies WHERE id = ?", [acc.proxy_id]) as any[];
        if (proxyRows.length > 0) {
            const parts = proxyRows[0].proxy_info.split(':');
            if (parts.length >= 2) {
                proxyOpts = {
                    server: `http://${parts[0]}:${parts[1]}`,
                    username: parts[2] || undefined,
                    password: parts[3] || undefined
                };
            }
        }
    }

    const { containerId } = await createContainer({ name: xid, proxy: proxyOpts });

    // Clear cookies/Start fresh
    console.log('Navigating to login page...');
    await execInContainer(containerId, 'navigate', { url: 'https://x.com/i/flow/login' });
    await new Promise(r => setTimeout(r, 10000));

    // Step-by-step UI interaction via eval
    // Note: This is an simplified example. X login flow has many variations.

    // Part 1: Enter Username
    console.log('Entering username...');
    const enterUser = `
        (function() {
            const input = document.querySelector('input[name="text"]');
            if (!input) return { ok: false, error: 'User input not found' };
            input.value = '${xid}';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Find next button
            const nextBtn = Array.from(document.querySelectorAll('[role="button"]')).find(b => b.innerText.includes('次へ') || b.innerText.includes('Next'));
            if (nextBtn) {
                nextBtn.click();
                return { ok: true, msg: 'User entered' };
            }
            return { ok: false, error: 'Next button not found' };
        })()
    `;
    const res1 = await evalInContext(containerId, enterUser);
    console.log('User result:', JSON.stringify(res1, null, 2));
    await new Promise(r => setTimeout(r, 5000));

    // Part 2: Enter Password
    console.log('Entering password...');
    const enterPass = `
        (function() {
            const input = document.querySelector('input[name="password"]');
            if (!input) return { ok: false, error: 'Pass input not found' };
            input.value = '${acc.x_password}';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Find login button
            const loginBtn = Array.from(document.querySelectorAll('[role="button"]')).find(b => b.innerText.includes('ログイン') || b.innerText.includes('Log in'));
            if (loginBtn) {
                loginBtn.click();
                return { ok: true, msg: 'Pass entered' };
            }
            return { ok: false, error: 'Login button not found' };
        })()
    `;
    const res2 = await evalInContext(containerId, enterPass);
    console.log('Pass result:', JSON.stringify(res2, null, 2));
    await new Promise(r => setTimeout(r, 8000));

    // Part 3: Check for 2FA
    console.log('Checking for 2FA...');
    const check2FA = `
        (function() {
            const input = document.querySelector('input[name="text"], input[data-testid="ocfEnterTextTextInput"]'); // Sometimes 2FA input
            const is2FA = document.body.innerText.includes('認証コード') || document.body.innerText.includes('Verification code');
            if (is2FA) return { ok: true, is2FA: true };
            return { ok: true, is2FA: false };
        })()
    `;
    const res3 = await evalInContext(containerId, check2FA);
    console.log('2FA check:', JSON.stringify(res3, null, 2));

    if (res3.ok && res3.result.is2FA) {
        let totp = '';
        try {
            if (acc.totp_secret) {
                totp = generateTOTPCode(acc.totp_secret);
            } else if (acc.twofa_code) {
                totp = acc.twofa_code; // If static
            }
        } catch (e) { }

        if (totp) {
            console.log(`Entering 2FA code: ${totp}...`);
            const enterTOTP = `
                (function() {
                    const input = document.querySelector('input[name="text"], input[data-testid="ocfEnterTextTextInput"]');
                    if (!input) return { ok: false, error: '2FA input not found' };
                    input.value = '${totp}';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    const nextBtn = Array.from(document.querySelectorAll('[role="button"]')).find(b => b.innerText.includes('次へ') || b.innerText.includes('Next') || b.innerText.includes('確認') || b.innerText.includes('Verify'));
                    if (nextBtn) {
                        nextBtn.click();
                        return { ok: true, msg: '2FA entered' };
                    }
                    return { ok: false, error: '2FA next button not found' };
                })()
            `;
            await evalInContext(containerId, enterTOTP);
            await new Promise(r => setTimeout(r, 10000));
        }
    }

    // Final check
    const finalCheck = `
        (function() {
            const url = window.location.href;
            if (url.includes('/home')) return { status: 'success', url };
            if (url.includes('/account/access')) return { status: 'locked', url };
            return { status: 'fail', url, html: document.body.innerText.slice(0, 100) };
        })()
    `;
    const finalRes = await evalInContext(containerId, finalCheck);
    console.log('Final Login status:', JSON.stringify(finalRes, null, 2));
}

main().catch(console.error);
