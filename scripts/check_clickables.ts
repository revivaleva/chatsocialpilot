
import { evalInContext } from '../src/drivers/browser.js';
async function main() {
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    const clickables = await evalInContext(cid, 'Array.from(document.querySelectorAll("*")).filter(el => el.innerText && el.innerText.length < 50 && (el.tagName === "DIV" || el.tagName === "SPAN") && window.getComputedStyle(el).cursor === "pointer").map(el => ({ text: el.innerText, tag: el.tagName, testId: el.getAttribute("data-testid") }))');
    console.log('Clickables:', JSON.stringify(clickables.result, null, 2));
}
main();
