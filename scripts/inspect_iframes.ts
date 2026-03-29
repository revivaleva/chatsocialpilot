
import { execInContainer, evalInContext } from '../src/drivers/browser.js';

async function main() {
    const cid = '3b51b016-3ffd-46e1-807d-23acc5573c9b';
    console.log('Inspecting iframes...');
    const res = await evalInContext(cid, `Array.from(document.querySelectorAll("iframe")).map(i => ({ id: i.id, name: i.name, src: i.src.slice(0, 100) }))`);
    console.log(JSON.stringify(res.result, null, 2));
}

main().catch(console.error);
