
import { evalInContext } from '../src/drivers/browser.js';
async function main() {
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    const iframes = await evalInContext(cid, 'Array.from(document.querySelectorAll("iframe")).map(f => ({ src: f.src, id: f.id, class: f.className }))');
    console.log('Iframes:', JSON.stringify(iframes.result, null, 2));
}
main();
