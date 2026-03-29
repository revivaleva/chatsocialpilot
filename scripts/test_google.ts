
import { execInContainer, evalInContext } from '../src/drivers/browser.js';
async function main() {
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    console.log('Navigating to google.com...');
    await execInContainer(cid, 'navigate', { url: 'https://www.google.com' });
    await new Promise(r => setTimeout(r, 10000));
    const title = await evalInContext(cid, 'document.title');
    console.log('Google Title:', title.result);
}
main();
