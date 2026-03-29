
import { initDb, query } from '../src/drivers/db.js';
import { evalInContext, createContainer, execInContainer } from '../src/drivers/browser.js';

async function main() {
    initDb();
    const xid = 'DonaldRobi54643';

    // Get account data
    const accRows = query("SELECT * FROM x_accounts WHERE container_id = ?", [xid]) as any[];
    if (accRows.length === 0) {
        console.error(`Account not found for container_id: ${xid}`);
        return;
    }

    const acc = accRows[0];
    const authToken = acc.auth_token;
    const ct0 = acc.ct0;

    console.log(`Testing login for ${xid} using auth_token...`);

    // 1. Create/Ensure container
    console.log('Ensuring container is open...');
    const createRes = await createContainer({ name: xid });
    if (!createRes.ok) {
        console.error('Failed to create container:', createRes.message);
        return;
    }
    const containerId = createRes.containerId;

    // 2. Navigate to X
    console.log(`Navigating to x.com (UID: ${containerId})...`);
    await execInContainer(containerId, 'navigate', { url: 'https://x.com' });

    // 3. Inject cookies via eval
    const cookieScript = `
        (function() {
            function setCookie(name, value) {
                document.cookie = name + "=" + value + "; domain=.x.com; path=/; SameSite=Lax; Secure; expires=Fri, 31 Dec 2030 23:59:59 GMT";
            }
            setCookie('auth_token', '${authToken}');
            if ('${ct0}') setCookie('ct0', '${ct0}');
            return { ok: true, msg: 'Cookies set' };
        })()
    `;

    console.log('Setting auth_token and ct0 cookies...');
    await evalInContext(containerId, cookieScript);

    // 4. Reload and Check
    console.log('Reloading to verify login...');
    await execInContainer(containerId, 'navigate', { url: 'https://x.com/home' });

    console.log('Waiting 10 seconds...');
    await new Promise(r => setTimeout(r, 10000));

    const checkScript = `
        (function() {
            const url = window.location.href;
            if (url.includes('/home')) return { status: 'success', url };
            if (url.includes('/login') || url.includes('/flow/login')) return { status: 'login_required', url };
            if (url.includes('/account/access')) return { status: 'locked', url };
            return { status: 'unknown', url, html: document.body.innerText.slice(0, 100) };
        })()
    `;

    const res = await evalInContext(containerId, checkScript);
    console.log('Login Test Result:', JSON.stringify(res, null, 2));
}

main().catch(console.error);
