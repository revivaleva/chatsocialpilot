
import { execInContainer, evalInContext } from '../src/drivers/browser.js';
async function main() {
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    console.log('Clearing cookies...');
    await evalInContext(cid, 'document.cookie.split(";").forEach(function(c) { document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); });');
    console.log('Navigating to login page...');
    await execInContainer(cid, 'navigate', { url: 'https://x.com/i/flow/login' });
    await new Promise(r => setTimeout(r, 10000));
    const title = await evalInContext(cid, 'document.title');
    console.log('Title:', title.result);
}
main();
