
import { evalInContext } from '../src/drivers/browser.js';
async function main() {
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    const elements = await evalInContext(cid, 'Array.from(document.querySelectorAll("div, span, button")).filter(e => e.innerText && (e.innerText.toLowerCase().includes("start") || e.innerText.toLowerCase().includes("verify") || e.innerText.toLowerCase().includes("認証"))).map(e => ({ tag: e.tagName, text: e.innerText, testId: e.getAttribute("data-testid") }))');
    console.log('Elements:', JSON.stringify(elements.result, null, 2));
}
main();
