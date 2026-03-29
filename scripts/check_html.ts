
import { evalInContext } from '../src/drivers/browser.js';
async function main() {
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    const res = await evalInContext(cid, 'document.documentElement.innerHTML');
    console.log(res.result);
}
main();
