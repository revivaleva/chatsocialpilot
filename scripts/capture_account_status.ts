
import { execInContainer } from '../src/drivers/browser.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
    const contextId = 'c518c6d7-a3d7-467b-beca-9b1e8f450708';
    console.log(`Investigating account for container: ${contextId}`);

    // 1. Navigate to Home with screenshot
    const navResult = await execInContainer(contextId, 'navigate', { url: 'https://x.com/home' }, { screenshot: true, timeoutMs: 60000 });
    console.log('Final URL:', navResult.url);
    console.log('Title:', navResult.title);

    if (navResult.screenshotPath && fs.existsSync(navResult.screenshotPath)) {
        const dest = path.join(process.cwd(), 'investigation_screenshot.png');
        fs.copyFileSync(navResult.screenshotPath, dest);
        console.log(`Copied screenshot to: ${dest}`);
    } else {
        console.log('No screenshot path returned or file missing.');
    }
}

main().catch(console.error);
