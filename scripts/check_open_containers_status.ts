
import { initDb, query } from '../src/drivers/db.js';
import { evalInContext, createContainer } from '../src/drivers/browser.js';
import fetch from 'node-fetch';

async function main() {
    initDb();

    // Get active containers
    const listRes = await fetch('http://127.0.0.1:3002/internal/containers/list');
    const data: any = await listRes.json();
    const list = data.containers || [];

    console.log(`Checking status for ${list.length} open containers...`);

    for (const c of list) {
        console.log(`\n--- Container: ${c.name} (${c.id}) ---`);
        try {
            const check = await evalInContext(c.id, `(function() {
                const url = window.location.href;
                const bodyText = document.body.innerText;
                const html = document.body.innerHTML;
                
                let type = 'unknown';
                if (url.includes('/home')) type = 'home';
                else if (url.includes('/account/access')) type = 'locked_recaptcha';
                else if (bodyText.includes('メールアドレスを確認') || bodyText.includes('Verification code') || bodyText.includes('認証コードを入力')) type = 'email_verification';
                else if (url.includes('/login') || url.includes('/flow/login')) type = 'login_screen';
                
                return { type, url, title: document.title, snippet: bodyText.slice(0, 100).replace(/\\n/g, ' ') };
            })()`);
            console.log(JSON.stringify(check.result, null, 2));
        } catch (e: any) {
            console.error(`Error checking ${c.name}:`, e.message);
        }
    }
}

main().catch(console.error);
