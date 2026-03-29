
import { evalInContext } from '../src/drivers/browser.js';
async function main() {
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    const inputs = await evalInContext(cid, 'Array.from(document.querySelectorAll("input")).map(i => ({ type: i.type, name: i.name, value: i.value, checked: i.checked }))');
    console.log('Inputs:', JSON.stringify(inputs.result, null, 2));
}
main();
