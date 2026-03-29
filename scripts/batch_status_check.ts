
import { execInContainer, createContainer, closeContainer } from '../src/drivers/browser';
import { initDb, query } from '../src/drivers/db';

async function batchDiagnose() {
    initDb();
    const gid = '6df1aacd-4623-4908-9e2d-9fa1d9990109'; // X兵隊
    const accounts = query('SELECT a.container_id FROM x_accounts a JOIN container_group_members m ON a.container_id = m.container_id WHERE m.group_id = ? LIMIT 300', [gid]) as any[];

    console.log(`--- Full Batch Status Check Start (${accounts.length} accounts) ---`);

    for (const acc of accounts) {
        const cid = acc.container_id;
        console.log(`Checking [${cid}]...`);
        try {
            // 1. Open (find or create)
            const openRes = await createContainer({ name: cid });
            const internalId = openRes.containerId;

            // 2. Wait a bit for page load
            await new Promise(r => setTimeout(r, 6000));

            // 3. Status check (IMPORTANT: Use internalId/UUID for execInContainer)
            const res = await execInContainer(internalId, 'eval', { eval: "({ url: window.location.href, title: document.title })" });
            const info = res.result || {};
            const url = info.url || "";
            const isHome = url.includes('home') && !url.includes('login');
            const isLocked = url.includes('access') || url.includes('checkpoint');
            const isLogin = url.includes('login');
            const status = isHome ? 'LOGGED_IN' : (isLocked ? 'LOCKED' : (isLogin ? 'LOGGED_OUT' : 'UNKNOWN'));

            console.log(`[${cid}] Status: ${status}, Title: "${info.title}", URL: ${url}`);

            // 4. Close to keep resources clean
            await closeContainer({ id: internalId });
        } catch (e: any) {
            console.log(`[${cid}] Error: ${e.message}`);
        }
    }

    console.log("--- Batch Status Check End ---");
}

batchDiagnose().catch(console.error);
