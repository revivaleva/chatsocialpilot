
import { evalInContext, execInContainer } from '../src/drivers/browser.js';
import path from 'node:path';
import fs from 'node:fs';

async function main() {
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c';
    const result = await evalInContext(cid, 'window.location.href', { screenshot: true } as any);

    console.log('Result:', JSON.stringify(result, null, 2));

    // execInContainer also returns screenshotPath if we use it directly
    const rawRes = await execInContainer(cid, 'eval', { eval: 'window.location.href' }, { screenshot: true });
    console.log('Raw Res:', JSON.stringify(rawRes, null, 2));

    if (rawRes.screenshotPath) {
        const dest = path.join(process.cwd(), 'artifacts', 'screenshot_sb.png');
        if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(rawRes.screenshotPath, dest);
        console.log('Screenshot copied to:', dest);
    }
}
main();
