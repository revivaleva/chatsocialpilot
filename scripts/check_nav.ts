
import { execInContainer, evalInContext } from '../src/drivers/browser.js';
async function main() {
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    console.log('Navigating to x.com...');
    await execInContainer(cid, 'navigate', { url: 'https://x.com' });
    await new Promise(r => setTimeout(r, 10000));
    const url = await evalInContext(cid, 'window.location.href');
    const title = await evalInContext(cid, 'document.title');
    console.log('Final URL:', url.result);
    console.log('Final Title:', title.result);
}
main();
