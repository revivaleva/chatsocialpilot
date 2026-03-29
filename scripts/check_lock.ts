
import { evalInContext } from '../src/drivers/browser.js';
async function main() {
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    const hasContinue = await evalInContext(cid, '!!document.querySelector("[data-testid=\'ocfEnterCheck\']")');
    const hasExplain = await evalInContext(cid, 'document.body.innerText.includes("このアカウントはロックされています")');
    console.log('Has Start/Continue Button:', hasContinue.result);
    console.log('Has Lock Explanation:', hasExplain.result);
}
main();
