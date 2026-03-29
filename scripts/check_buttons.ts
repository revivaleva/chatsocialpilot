
import { evalInContext } from '../src/drivers/browser.js';
async function main() {
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    const buttons = await evalInContext(cid, 'Array.from(document.querySelectorAll("button, [role=\'button\']")).map(b => ({ text: b.innerText, testId: b.getAttribute("data-testid") }))');
    console.log('Buttons:', JSON.stringify(buttons.result, null, 2));
}
main();
