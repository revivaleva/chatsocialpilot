
import { createContainer, execInContainer, evalInContext, closeContainer } from '../src/drivers/browser';
import { initDb, query } from '../src/drivers/db';

async function main() {
    initDb();
    const name = 'barbara75955314'; // Target confirmed LOCKED in previous batch

    // 1. Get account and proxy info
    const acc = (query('SELECT * FROM x_accounts WHERE container_id = ?', [name]) as any[])[0];
    if (!acc) {
        console.error(`Account not found: ${name}`);
        return;
    }

    const proxyRow = (query('SELECT * FROM proxies WHERE id = ?', [acc.proxy_id]) as any[])[0];
    let proxy: any = null;
    if (proxyRow) {
        const parts = proxyRow.proxy_info.split(':');
        if (parts.length === 4) {
            proxy = { server: `${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
        }
    }

    // 2. Open Container
    console.log(`--- REMEDY TEST: ${name} ---`);
    const openRes = await createContainer({ name, proxy });
    const internalId = openRes.containerId; // UUID

    // 3. Status BEFORE (confirm LOCKED)
    console.log("Checking status BEFORE remedy...");
    await new Promise(r => setTimeout(r, 6000));
    const preStatus = await execInContainer(internalId, 'eval', { eval: "({ url: window.location.href, title: document.title })" }, { screenshot: true });
    console.log(`BEFORE status: URL: ${preStatus.result?.url}, Title: ${preStatus.result?.title}, Screenshot: ${preStatus.screenshotPath}`);

    if (!(preStatus.result?.url || "").includes('access')) {
        console.warn("Account might not be LOCKED right now. Proceeding anyway...");
    }

    // 4. APPLY REMEDY (Cookie Injection)
    console.log("Applying REMEDY: Injecting cookies...");
    await execInContainer(internalId, 'navigate', { url: 'https://x.com' });
    await new Promise(r => setTimeout(r, 6000));

    await evalInContext(internalId, `
        (function() {
            function setCookie(n, v) {
                document.cookie = n + "=" + v + "; domain=.x.com; path=/; SameSite=Lax; Secure; expires=Fri, 31 Dec 2030 23:59:59 GMT";
            }
            setCookie('auth_token', '${acc.auth_token}');
            setCookie('ct0', '${acc.ct0}');
            console.log("Cookie Remedy Applied.");
        })()
    `);

    // 5. Navigate to /home
    console.log("Navigating to /home...");
    await execInContainer(internalId, 'navigate', { url: 'https://x.com/home' });
    await new Promise(r => setTimeout(r, 15000));

    // 6. Status AFTER
    console.log("Checking status AFTER remedy...");
    const postStatus = await execInContainer(internalId, 'eval', { eval: "({ url: window.location.href, title: document.title })" }, { screenshot: true });
    console.log(`AFTER status: URL: ${postStatus.result?.url}, Title: ${postStatus.result?.title}, Screenshot: ${postStatus.screenshotPath}`);

    if (postStatus.result?.url.includes('home')) {
        console.log("SUCCESS: REMEDY worked! Account is now LOGGED_IN.");
    } else {
        console.log("FAILED: REMEDY did not work. Check screenshot.");
    }

    // 7. Cleanup
    // await closeContainer({ id: internalId });
}

main().catch(console.error);
