
import { createContainer, execInContainer, closeContainer } from '../src/drivers/browser';
import { initDb, query } from '../src/drivers/db';

async function main() {
    initDb();
    const name = 'barbara76596490'; // Target confirmed LOCKED in previous batch

    // 1. Get account and proxy info
    const acc = (query('SELECT * FROM x_accounts WHERE container_id = ?', [name]) as any[])[0];
    const proxyRow = (query('SELECT * FROM proxies WHERE id = ?', [acc.proxy_id]) as any[])[0];
    let proxy: any = null;
    if (proxyRow) {
        const parts = proxyRow.proxy_info.split(':');
        if (parts.length === 4) {
            proxy = { server: `${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
        }
    }

    // 2. Open Container & JUST NAVIGATE TO HOME
    console.log(`--- NAVIGATION ONLY TEST: ${name} ---`);
    const openRes = await createContainer({ name, proxy });
    const internalId = openRes.containerId;

    console.log("Navigating directly to /home (NO INJECTION)...");
    await execInContainer(internalId, 'navigate', { url: 'https://x.com/home' });
    await new Promise(r => setTimeout(r, 15000));

    // 3. Status check
    const status = await execInContainer(internalId, 'eval', { eval: "({ url: window.location.href, title: document.title })" }, { screenshot: true });
    console.log(`Status: URL: ${status.result?.url}, Title: ${status.result?.title}, Screenshot: ${status.screenshotPath}`);

    if (status.result?.url.includes('home')) {
        console.log("SUCCESS: Pure navigation worked! Account is LOGGED_IN.");
    } else {
        console.log("FAILED: Pure navigation did not work. Need injection or click.");
    }

    // await closeContainer({ id: internalId });
}

main().catch(console.error);
