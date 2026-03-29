
import { createContainer, execInContainer, evalInContext, humanClickInContext } from '../src/drivers/browser.js';
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const xid = 'SBneder60540';
    const acc = (query('SELECT * FROM x_accounts WHERE container_id = ?', [xid]) as any[])[0];
    const proxyRow = (query('SELECT * FROM proxies WHERE id = ?', [acc.proxy_id]) as any[])[0];

    if (!acc || !proxyRow) {
        console.error('Account or Proxy not found');
        return;
    }

    const parts = proxyRow.proxy_info.split(':');
    const proxy = {
        server: `http://${parts[0]}:${parts[1]}`,
        username: parts[2],
        password: parts[3]
    };

    console.log(`Starting login test for ${xid}...`);
    const createRes = await createContainer({ name: xid, proxy });
    if (!createRes.ok) {
        console.error('Failed to open container:', createRes.message);
        return;
    }
    const cid = createRes.containerId;
    console.log(`Container opened: ${cid}. Waiting for window initialization...`);
    await new Promise(r => setTimeout(r, 15000));

    // 1. Inject Cookies
    console.log('Injecting cookies...');
    await execInContainer(cid, 'navigate', { url: 'https://x.com' });
    await new Promise(r => setTimeout(r, 5000));
    await evalInContext(cid, `
        (function() {
            function setCookie(n, v) {
                document.cookie = n + "=" + v + "; domain=.x.com; path=/; SameSite=Lax; Secure; expires=Fri, 31 Dec 2030 23:59:59 GMT";
            }
            setCookie('auth_token', '${acc.auth_token}');
            setCookie('ct0', '${acc.ct0}');
        })()
    `);

    // 2. Navigate to Home
    console.log('Navigating to home...');
    await execInContainer(cid, 'navigate', { url: 'https://x.com/home' });
    await new Promise(r => setTimeout(r, 10000));

    // 3. Status Check
    const checkStatus = async () => {
        const url = await evalInContext(cid, 'window.location.href');
        const html = await evalInContext(cid, 'document.documentElement.innerHTML');

        if (url.includes('google.com')) return 'blocked_or_redirected';
        if (html.includes('Challenge') || html.includes('challenge')) return 'cloudflare';
        if (html.includes('id="layers"') || html.includes('data-testid="primaryColumn"')) return 'logged_in';
        if (url.includes('login')) return 'login_screen';
        return 'unknown';
    };

    let status = await checkStatus();
    console.log('Initial Status:', status);

    if (status === 'cloudflare') {
        console.log('Cloudflare detected. Attempting humanClick...');
        await humanClickInContext(cid, 'iframe'); // General attempt
        await new Promise(r => setTimeout(r, 10000));
        status = await checkStatus();
        console.log('Status after humanClick:', status);
    }

    if (status === 'logged_in') {
        console.log('SUCCESS: Logged in to SBneder60540');
    } else {
        console.log('FAILED: Current status is', status);
    }
}

main().catch(console.error);
