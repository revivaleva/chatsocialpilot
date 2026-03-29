
import { initDb, query } from '../src/drivers/db.js';
import { evalInContext, createContainer, execInContainer, closeContainer } from '../src/drivers/browser.js';
import { generateTOTPCode } from '../src/services/totpGenerator.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
    initDb();

    // 1. Extract 20 Locked accounts from logs
    const logsDir = path.resolve('logs');
    const files = fs.readdirSync(logsDir).filter(f => f.startsWith('run-login-check-') && f.endsWith('.json'));

    const targetAccounts: { xid: string; uuid: string }[] = [];
    for (const file of files) {
        try {
            const runId = file.replace('.json', '');
            const content = JSON.parse(fs.readFileSync(path.join(logsDir, file), 'utf8'));
            const evalStep = content.steps.find((s: any) => s.step.type === 'eval');
            if (evalStep?.result?.body?.result?.status === 'locked') {
                const taskRows = query("SELECT container_id FROM tasks WHERE runId = ?", [runId]) as any[];
                if (taskRows.length > 0) {
                    targetAccounts.push({ xid: taskRows[0].container_id, uuid: content.containerId });
                }
            }
        } catch (e) { }
        if (targetAccounts.length >= 20) break;
    }

    console.log(`Processing batch of ${targetAccounts.length} locked accounts...`);

    const results: any[] = [];
    for (const target of targetAccounts) {
        const xid = target.xid;
        console.log(`\n--- Processing Account: ${xid} ---`);

        try {
            // Find account in DB
            const accRows = query("SELECT * FROM x_accounts WHERE container_id = ?", [xid]) as any[];
            if (accRows.length === 0) throw new Error(`Account not found in DB: ${xid}`);
            const acc = accRows[0];

            // Get proxy
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

            // Step 1: Open Container
            console.log(`Opening container for ${xid}...`);
            const createRes = await createContainer({ name: xid, proxy: proxyOpts });
            if (!createRes.ok) throw new Error(`Create failed: ${createRes.message}`);
            const containerId = createRes.containerId;

            // Step 2: Navigate to Home and Check status
            console.log('Navigating to x.com/home...');
            await execInContainer(containerId, 'navigate', { url: 'https://x.com/home' });

            // Wait for redirect
            await new Promise(r => setTimeout(r, 6000));

            const initialCheck = await evalInContext(containerId, `(function() {
                const url = window.location.href;
                if (url.includes('/home')) return 'active';
                if (url.includes('/login') || url.includes('/flow/login')) return 'logged_out';
                if (url.includes('/account/access')) return 'locked';
                return 'unknown';
            })()`);

            let currentStatus = initialCheck.result || 'unknown';
            console.log(`Initial Status: ${currentStatus}`);

            // Step 3: Handle Logged Out
            if (currentStatus === 'logged_out') {
                console.log('Detected Logged Out. Attempting Login...');

                // Login Flow
                // A. Enter Username
                console.log('Entering username...');
                await evalInContext(containerId, `(function() {
                    const input = document.querySelector('input[name="text"]');
                    if (input) {
                        input.value = '${xid}';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        const nextBtn = Array.from(document.querySelectorAll('[role="button"]')).find(b => b.innerText.includes('次へ') || b.innerText.includes('Next'));
                        if (nextBtn) nextBtn.click();
                    }
                })()`);
                await new Promise(r => setTimeout(r, 4000));

                // B. Enter Password
                console.log('Entering password...');
                await evalInContext(containerId, `(function() {
                    const input = document.querySelector('input[name="password"]');
                    if (input) {
                        input.value = '${acc.x_password}';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        const loginBtn = Array.from(document.querySelectorAll('[role="button"]')).find(b => b.innerText.includes('ログイン') || b.innerText.includes('Log in'));
                        if (loginBtn) loginBtn.click();
                    }
                })()`);
                await new Promise(r => setTimeout(r, 6000));

                // C. 2FA (if needed)
                let totp = '';
                try { if (acc.totp_secret) totp = generateTOTPCode(acc.totp_secret); else if (acc.twofa_code) totp = acc.twofa_code; } catch (e) { }

                if (totp) {
                    console.log(`Attempting 2FA with code ${totp}...`);
                    await evalInContext(containerId, `(function() {
                        const input = document.querySelector('input[name="text"], input[data-testid="ocfEnterTextTextInput"]');
                        if (input) {
                            input.value = '${totp}';
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            const nextBtn = Array.from(document.querySelectorAll('[role="button"]')).find(b => b.innerText.includes('次へ') || b.innerText.includes('Next') || b.innerText.includes('確認') || b.innerText.includes('Verify'));
                            if (nextBtn) nextBtn.click();
                        }
                    })()`);
                    await new Promise(r => setTimeout(r, 8000));
                }

                // Final Re-check Status
                const recheck = await evalInContext(containerId, `(function() {
                    const url = window.location.href;
                    if (url.includes('/home')) return 'active';
                    if (url.includes('/account/access')) return 'locked';
                    return 'unable_to_verify';
                })()`);
                currentStatus = recheck.result || 'unknown';
                console.log(`Re-check Status: ${currentStatus}`);
            }

            // Step 4: Rule execution
            if (currentStatus === 'active') {
                console.log('Status is ACTIVE. Closing container.');
                await closeContainer({ id: containerId });
                results.push({ xid, status: 'active', action: 'closed' });
            } else if (currentStatus === 'locked') {
                console.log('Status is LOCKED. Keeping container OPEN.');
                results.push({ xid, status: 'locked', action: 'kept_open' });
            } else {
                console.log(`Status is ${currentStatus}. Keeping container OPEN.`);
                results.push({ xid, status: currentStatus, action: 'kept_open' });
            }

        } catch (e: any) {
            console.error(`Error processing ${xid}:`, e.message);
            results.push({ xid, status: 'error', error: e.message, action: 'skipped' });
        }
    }

    console.log('\n--- Final Summary ---');
    console.table(results);
}

main().catch(console.error);
