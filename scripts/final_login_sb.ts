
import { execInContainer, evalInContext } from '../src/drivers/browser.js';
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const xid = 'SBneder60540';
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    const acc = (query('SELECT * FROM x_accounts WHERE container_id = ?', [xid]) as any[])[0];

    console.log(`Setting cookies for ${xid}...`);
    await execInContainer(cid, 'navigate', { url: 'https://x.com' });
    await new Promise(r => setTimeout(r, 10000));

    // Clear and set
    await evalInContext(cid, `
        (function() {
            function setCookie(n, v) {
                document.cookie = n + "=" + v + "; domain=.x.com; path=/; SameSite=Lax; Secure; expires=Fri, 31 Dec 2030 23:59:59 GMT";
            }
            // Clear existing
            document.cookie.split(";").forEach(function(c) { 
                document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date(0).toUTCString() + ";path=/;domain=.x.com"); 
            });
            // Set
            setCookie('auth_token', '${acc.auth_token}');
            setCookie('ct0', '${acc.ct0}');
        })()
    `);

    console.log('Navigating to x.com/home...');
    await execInContainer(cid, 'navigate', { url: 'https://x.com/home' });
    await new Promise(r => setTimeout(r, 15000));

    const url = await evalInContext(cid, 'window.location.href');
    const title = await evalInContext(cid, 'document.title');
    const text = await evalInContext(cid, 'document.body.innerText');

    console.log('URL:', url.result);
    console.log('Title:', title.result);
    console.log('Text (first 200 chars):', text.result ? text.result.substring(0, 200) : 'null');

    if (url.result && url.result.includes('home')) {
        console.log('SUCCESS: Logged in (probably)');
    } else if (url.result && url.result.includes('access')) {
        console.log('LOCKED: Account Access page detected.');
    } else if (url.result && url.result.includes('login')) {
        console.log('LOGIN SCREEN: Cookies rejected.');
    }
}
main().catch(console.error);
