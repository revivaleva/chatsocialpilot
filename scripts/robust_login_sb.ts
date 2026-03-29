
import { execInContainer, evalInContext } from '../src/drivers/browser.js';
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const xid = 'SBneder60540';
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    const acc = (query('SELECT * FROM x_accounts WHERE container_id = ?', [xid]) as any[])[0];

    if (!acc) {
        console.error('Account not found in SQLite: x_accounts');
        return;
    }

    console.log(`Phase 1: Clear all cookies and localStorage for ${xid}...`);
    // Ensure we are on x.com first to clear localStorage
    await execInContainer(cid, 'navigate', { url: 'https://x.com' });
    await new Promise(r => setTimeout(r, 7000));

    await evalInContext(cid, `
        (function() {
            // 1. Clear Cookies
            document.cookie.split(";").forEach(function(c) { 
                const name = c.split("=")[0].trim();
                document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
                document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.x.com";
            });
            // 2. Clear Local Storage
            localStorage.clear();
            sessionStorage.clear();
        })()
    `);

    console.log('Phase 2: Injecting latest cookies...');
    await evalInContext(cid, `
        (function() {
            function setCookie(n, v) {
                document.cookie = n + "=" + v + "; domain=.x.com; path=/; SameSite=Lax; Secure; expires=Fri, 31 Dec 2030 23:59:59 GMT";
            }
            setCookie('auth_token', '${acc.auth_token}');
            setCookie('ct0', '${acc.ct0}');
        })()
    `);

    console.log('Phase 3: Navigating to x.com/home with fresh cookies...');
    await execInContainer(cid, 'navigate', { url: 'https://x.com/home' });

    // Wait bit longer for content to load
    console.log('Waiting for stability (20s)...');
    await new Promise(r => setTimeout(r, 20000));

    const url = await evalInContext(cid, 'window.location.href');
    const title = await evalInContext(cid, 'document.title');
    const html = await evalInContext(cid, 'document.documentElement.innerHTML');

    console.log('Final URL:', url.result);
    console.log('Final Title:', title.result);

    if (url.result && url.result.includes('home')) {
        console.log('SUCCESS: Logged in (probably)');
    } else if (html && (html.includes('Challenge') || html.includes('challenge') || html.includes('ボット'))) {
        console.log('STILL BLOCKED: Cloudflare / Bot detection still visible.');
    } else if (url.result && url.result.includes('access')) {
        console.log('LOCKED: Account Access page detected.');
    } else if (url.result && url.result.includes('login')) {
        console.log('LOGIN SCREEN: Auth token rejected by server.');
    } else {
        console.log('UNKNOWN STATE: Please check screenshot.');
    }

    // Always take a screenshot for reporting
    await execInContainer(cid, 'eval', { eval: 'document.title' }, { screenshot: true });
}

main().catch(console.error);
