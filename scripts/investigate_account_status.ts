
import { execInContainer } from '../src/drivers/browser.js';
import fs from 'node:fs';

async function main() {
    const contextId = 'c518c6d7-a3d7-467b-beca-9b1e8f450708';
    console.log(`Checking account status for container: ${contextId}`);

    // 1. Navigate to Home
    console.log('Navigating to x.com/home...');
    const navResult = await execInContainer(contextId, 'navigate', { url: 'https://x.com/home' }, { screenshot: true, timeoutMs: 60000 });
    console.log('Final URL:', navResult.url);
    console.log('Title:', navResult.title);
    if (navResult.screenshotPath) {
        console.log('Screenshot saved to:', navResult.screenshotPath);
        // Copy screenshot to artifacts for viewing
        // In this environment, I should probably just log it or use the browser tool to see it.
    }

    // 2. Check current page content for lock/ban indicators
    const evalResult = await execInContainer(contextId, 'eval', {
        code: `(function() {
            return {
                url: window.location.href,
                text: document.body.innerText.substring(0, 1000),
                isLocked: window.location.href.includes('/account/access'),
                isSuspended: document.body.innerText.includes('Your account is suspended')
            };
        })()`
    });
    console.log('Status Check Result:', JSON.stringify(evalResult.result, null, 2));
}

main().catch(console.error);
