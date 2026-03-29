
import { execInContainer, createContainer } from '../src/drivers/browser.js';

async function main() {
    const xid = 'nancy9869865732';
    console.log(`Ensuring container ${xid}...`);
    const res = await createContainer({ name: xid });
    console.log('Create result:', JSON.stringify(res, null, 2));

    if (res.ok) {
        const cid = res.containerId;
        console.log(`Testing simple navigate to google (UID: ${cid})...`);
        const navRes = await execInContainer(cid, 'navigate', { url: 'https://www.google.com' });
        console.log('Navigate result:', JSON.stringify(navRes, null, 2));

        if (navRes.ok) {
            console.log('Testing simple eval...');
            const evalRes = await execInContainer(cid, 'eval', { code: 'document.title' });
            console.log('Eval result:', JSON.stringify(evalRes, null, 2));
        }
    }
}

main().catch(console.error);
