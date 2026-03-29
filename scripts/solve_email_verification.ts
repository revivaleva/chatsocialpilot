
import { initDb, query } from './src/drivers/db';
import { fetchVerificationCode } from './src/services/emailFetcher';
import { execInContainer, evalInContext } from './src/drivers/browser';

async function main() {
    initDb();

    // 1. Get active IDs
    const activeRes = await fetch('http://127.0.0.1:3002/internal/containers/active');
    const activeData = await activeRes.json() as any;
    const activeIds = activeData.activeIds as string[];

    console.log(`Active IDs: ${activeIds.length}`);

    // 2. Get container list to map ID to Name
    const listRes = await fetch('http://127.0.0.1:3002/internal/containers/list');
    const listData = await listRes.json() as any;
    const containers = listData.containers as any[];

    const idToName: Record<string, string> = {};
    for (const c of containers) {
        if (activeIds.includes(c.id)) {
            idToName[c.id] = c.name;
        }
    }

    // 3. Process each active container
    for (const id of activeIds) {
        const name = idToName[id];
        if (!name) {
            console.log(`[${id}] Name not found in list.`);
            continue;
        }

        console.log(`[${id}] Processing ${name}...`);

        // Get email info from DB
        const accs = query('SELECT * FROM x_accounts WHERE container_id = ?', [name]);
        if (accs.length === 0) {
            console.log(`  [${name}] Account not found in DB.`);
            continue;
        }
        const acc = accs[0];

        // Check current status
        const statusRes = await evalInContext(id, `(function() {
            return {
                url: window.location.href,
                title: document.title,
                hasSendButton: !!Array.from(document.querySelectorAll('div[role="button"], input[type="submit"], span')).find(el => el.innerText.includes('Send email') || el.innerText.includes('メールを送信')),
                hasCodeInput: !!document.querySelector('input[name="verfication_code"], input[placeholder*="code"], input[placeholder*="コード"]')
            };
        })()`);

        if (!statusRes.ok) {
            console.log(`  [${name}] Failed to get status: ${statusRes.error}`);
            continue;
        }

        const status = statusRes.result;
        console.log(`  [${name}] URL: ${status.url} | Title: ${status.title}`);

        if (status.hasSendButton) {
            console.log(`  [${name}] "Send email" button found. Clicking...`);
            await evalInContext(id, `(function() {
                const btn = Array.from(document.querySelectorAll('div[role="button"], input[type="submit"], span')).find(el => el.innerText.includes('Send email') || el.innerText.includes('メールを送信'));
                if (btn) btn.click();
            })()`);

            console.log(`  [${name}] Waiting 20s for email...`);
            await new Promise(r => setTimeout(r, 20000));
        } else if (status.hasCodeInput) {
            console.log(`  [${name}] Code input already present. Proceeding to fetch email.`);
        } else {
            console.log(`  [${name}] Neither send button nor code input found. Skipping.`);
            continue;
        }

        // 4. Fetch email
        console.log(`  [${name}] Fetching email for ${acc.email}...`);
        const emailRes = await fetchVerificationCode({
            email: acc.email,
            email_password: acc.email_password,
            timeout_seconds: 60
        });

        if (!emailRes.ok) {
            console.log(`  [${name}] Failed to fetch email: ${emailRes.error} - ${emailRes.message}`);
            continue;
        }

        const code = emailRes.code;
        console.log(`  [${name}] Got code: ${code}. Inputting...`);

        // 5. Input code and submit
        await evalInContext(id, `(function() {
            const input = document.querySelector('input[name="verfication_code"], input[placeholder*="code"], input[placeholder*="コード"]');
            if (input) {
                input.value = '${code}';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                
                // Submit - try to find Next/Submit button
                setTimeout(() => {
                    const nextBtn = Array.from(document.querySelectorAll('div[role="button"], input[type="submit"], span')).find(el => 
                        el.innerText.includes('Next') || el.innerText.includes('Submit') || el.innerText.includes('次へ') || el.innerText.includes('送信')
                    );
                    if (nextBtn) nextBtn.click();
                }, 500);
            }
        })()`);

        console.log(`  [${name}] Done. Waiting for navigation...`);
        await new Promise(r => setTimeout(r, 5000));
    }
}

main().catch(console.error);
