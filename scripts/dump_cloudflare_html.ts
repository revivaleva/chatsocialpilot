
import { execInContainer } from '../src/drivers/browser.js';
import fs from 'node:fs';

async function main() {
    const res = await execInContainer('3b51b016-3ffd-46e1-807d-23acc5573c9b', 'eval', { eval: 'document.body.innerHTML' });
    if (res.ok) {
        fs.writeFileSync('cloudflare_html.html', res.result, 'utf8');
        console.log('Dumped HTML to cloudflare_html.html');
    }
}

main().catch(console.error);
