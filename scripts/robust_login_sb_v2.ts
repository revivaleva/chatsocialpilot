
import { execInContainer, evalInContext } from '../src/drivers/browser.js';
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const xid = 'SBneder60540';
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    const acc = (query('SELECT * FROM x_accounts WHERE container_id = ?', [xid]) as any[])[0];

    console.log(`Phase 1: Clear and prepare for ${xid}...`);
    await execInContainer(cid, 'navigate', { url: 'https://x.com' });
    await new Promise(r => setTimeout(r, 7000));

    await evalInContext(cid, `
        (function() {
            // Clear Cookies and Storage
            document.cookie.split(";").forEach(function(c) { 
                const name = c.split("=")[0].trim();
                document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.x.com";
            });
            localStorage.clear();
        })()
    `);

    console.log('Phase 2: Setting auth_token ONLY to let X generate its own ct0/cookies...');
    await evalInContext(cid, `
        (function() {
            document.cookie = "auth_token=${acc.auth_token}; domain=.x.com; path=/; SameSite=Lax; Secure; expires=Fri, 31 Dec 2030 23:59:59 GMT";
        })()
    `);

    console.log('Phase 3: Navigating to x.com (base) to settle cookies...');
    await execInContainer(cid, 'navigate', { url: 'https://x.com' });
    await new Promise(r => setTimeout(r, 10000));

    // Get current cookies to check if ct0 was generated
    const cookiesRes = await execInContainer(cid, 'eval', { eval: 'document.cookie' });
    console.log('Current Cookies (X context):', cookiesRes.result ? cookiesRes.result.substring(0, 100) + '...' : 'null');

    console.log('Phase 4: Navigating to x.com/home...');
    await execInContainer(cid, 'navigate', { url: 'https://x.com/home' });
    await new Promise(r => setTimeout(r, 15000));

    const url = await evalInContext(cid, 'window.location.href');
    const title = await evalInContext(cid, 'document.title');
    const text = await evalInContext(cid, 'document.body.innerText');

    console.log('Final URL:', url.result);
    console.log('Final Title:', title.result);

    if (url.result && url.result.includes('home')) {
        console.log('SUCCESS: Home screen reached!');
    } else {
        console.log('Status: Still not at home. See details above.');
    }

    // Screenshot
    await execInContainer(cid, 'eval', { eval: 'document.title' }, { screenshot: true });
}

main().catch(console.error);
