
import { evalInContext, execInContainer } from '../src/drivers/browser.js';
import * as fs from 'fs';

async function main() {
    const cid = '5641655e-abc0-4a26-8b92-757cedb3f21c'; // From V5 log

    console.log(`Inspecting container: ${cid}`);

    const res = await execInContainer(cid, 'eval', {
        eval: '(() => { return { url: window.location.href, html: document.documentElement.outerHTML.substring(0, 5000), text: document.body.innerText.substring(0, 1000) }; })()'
    }, { returnHtml: true });

    if (res.ok) {
        fs.writeFileSync('notes/debug_screen.json', JSON.stringify(res, null, 2));
        console.log('Result saved to notes/debug_screen.json');
        console.log('Current URL:', res.result?.url || res.body?.result?.url);
    } else {
        console.error('Failed to inspect:', res.message || res.error);
    }
}

main().catch(console.error);
