
import { evalInContext, humanClickInContext } from '../src/drivers/browser.js';

async function main() {
    const cid = '3b51b016-3ffd-46e1-807d-23acc5573c9b';

    console.log('Searching for clickable elements in Cloudflare challenge...');

    // 1. Check for Turnstile checkbox in Shadow DOM or Iframes
    const findRes = await evalInContext(cid, `(function() {
        // Search in main document
        const base = document.querySelector('#AOzYg6') || document.body;
        
        function findClickable(root) {
            const elements = Array.from(root.querySelectorAll('*'));
            for (const el of elements) {
                const style = window.getComputedStyle(el);
                if (style.cursor === 'pointer' || el.onclick || el.innerText.includes('Verify') || el.id.includes('widget')) {
                    return { tagName: el.tagName, id: el.id, className: el.className, text: el.innerText.slice(0, 50) };
                }
            }
            return null;
        }

        // Try to find iframes again (Wait longer or deep search)
        const iframes = Array.from(document.querySelectorAll('iframe'));
        
        return {
            iframes: iframes.map(i => i.src.slice(0, 100)),
            clickable: findClickable(document),
            // Look for specific Turnstile markers
            turnstile: !!document.querySelector('[name="cf-turnstile-response"]')
        };
    })()`);

    console.log('Search Result:', JSON.stringify(findRes.result, null, 2));

    // 2. Try Human Click on the container
    if (findRes.result?.turnstile) {
        console.log('Turnstile detected. Attempting humanClick on the container area...');
        // Usually clicking the center of the widget container triggers the checkbox
        const clickRes = await humanClickInContext(cid, '#AOzYg6');
        console.log('humanClick Result:', JSON.stringify(clickRes, null, 2));

        await new Promise(r => setTimeout(r, 10000));

        const finalCheck = await evalInContext(cid, 'window.location.href');
        console.log('New URL:', finalCheck.result);
    }
}

main().catch(console.error);
