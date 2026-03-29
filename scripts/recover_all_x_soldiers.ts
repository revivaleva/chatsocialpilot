
import { createContainer, execInContainer, evalInContext, closeContainer } from '../src/drivers/browser';
import { initDb, query } from '../src/drivers/db';

async function recoverAllHybrid() {
    initDb();
    const gid = '6df1aacd-4623-4908-9e2d-9fa1d9990109'; // X兵隊
    const accounts = query('SELECT a.container_id, a.auth_token, a.ct0, a.proxy_id FROM x_accounts a JOIN container_group_members m ON a.container_id = m.container_id WHERE m.group_id = ?', [gid]) as any[];

    console.log(`--- HYBRID RECOVERY OPERATION START: ${accounts.length} accounts ---`);
    const results: any = { success: 0, skipped: 0, failed: 0 };

    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const name = acc.container_id;
        console.log(`\n[${i + 1}/${accounts.length}] Processing: ${name}`);

        try {
            // 1. Setup Proxy
            const proxyRow = (query('SELECT * FROM proxies WHERE id = ?', [acc.proxy_id]) as any[])[0];
            let proxy: any = null;
            if (proxyRow) {
                const parts = proxyRow.proxy_info.split(':');
                if (parts.length === 4) {
                    proxy = { server: `${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
                }
            }

            // 2. Open Container
            const openRes = await createContainer({ name, proxy });
            const internalId = openRes.containerId;

            // 3. DIAGNOSIS: Wait a bit for page load (6s)
            console.log(`[${name}] Checking status...`);
            await new Promise(r => setTimeout(r, 6000));
            let statusRes = await execInContainer(internalId, 'eval', { eval: "({ url: window.location.href, title: document.title })" });
            let currentUrl = statusRes.result?.url || "";

            const isHome = currentUrl.includes('home') && !currentUrl.includes('login');

            if (isHome) {
                console.log(`[${name}] ALREADY LOGGED_IN. Skipping.`);
                results.skipped++;
            } else {
                // 4. STEP 2: Apply Remedy (Cookie Injection) for Locked or Logged Out
                console.log(`[${name}] Status: ${currentUrl}. Applying Remedy (Native Injection)...`);

                await execInContainer(internalId, 'navigate', { url: 'https://x.com' });
                await new Promise(r => setTimeout(r, 4000));

                // Native Cookie Injection (Bypasses HttpOnly restrictions)
                console.log(`[${name}] Setting auth_token via native API...`);
                await execInContainer(internalId, 'setCookie', { name: 'auth_token', value: acc.auth_token, domain: '.x.com' });
                if (acc.ct0) {
                    await execInContainer(internalId, 'setCookie', { name: 'ct0', value: acc.ct0, domain: '.x.com' });
                }

                await execInContainer(internalId, 'navigate', { url: 'https://x.com/home' });
                await new Promise(r => setTimeout(r, 12000));

                statusRes = await execInContainer(internalId, 'eval', { eval: "({ url: window.location.href, title: document.title })" });
                currentUrl = statusRes.result?.url || "";

                if (currentUrl.includes('home') && !currentUrl.includes('login')) {
                    console.log(`[${name}] SUCCESS: Home reached via Remedy.`);
                    results.success++;
                } else {
                    console.log(`[${name}] FAILED: Still at ${currentUrl}`);
                    results.failed++;
                }
            }

            // 5. Close Container
            await closeContainer({ id: internalId });

        } catch (e: any) {
            console.error(`[${name}] Error: ${e.message}`);
            results.failed++;
        }
    }

    console.log(`\n--- HYBRID RECOVERY COMPLETE ---`);
    console.log(`Total: ${accounts.length}, Success/AlreadyIn: ${results.success + results.skipped}, Failed: ${results.failed}`);
}

recoverAllHybrid().catch(console.error);
