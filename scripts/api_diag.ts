
import { execInContainer } from '../src/drivers/browser';

async function diagnose() {
    const cid = '9c1b5044-d3c3-4862-97da-8bac5d5d6072'; // nanotimber63478

    console.log("Navigating to google.com...");
    await execInContainer(cid, 'navigate', { url: 'https://www.google.com' });
    await new Promise(r => setTimeout(r, 5000));

    console.log("--- API Diagnostic Start ---");

    // 1. Check eval (1+1)
    console.log("Checking 'eval' (1+1)...");
    const evalRes = await execInContainer(cid, 'eval', { eval: "1+1" });
    console.log("Eval Result:", JSON.stringify(evalRes));

    // 2. Check getElementRect (on body)
    console.log("Checking 'getElementRect' (body)...");
    const rectRes = await execInContainer(cid, 'getElementRect', { selector: 'body' });
    console.log("Rect Result:", JSON.stringify(rectRes));

    // 4. Network Probe
    console.log("Probing Network Status...");
    const netRes = await execInContainer(cid, 'eval', {
        eval: `(async () => {
            const results = {
                onLine: navigator.onLine,
                userAgent: navigator.userAgent,
                fetchTest: 'pending'
            };
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);
                await fetch('https://www.google.com', { mode: 'no-cors', signal: controller.signal });
                results.fetchTest = 'success';
            } catch (e) {
                results.fetchTest = 'failed: ' + String(e.message || e);
            }
            return results;
        })()`
    });
    console.log("Network Result:", JSON.stringify(netRes.result));

    console.log("--- Diagnostic End ---");
}

diagnose().catch(console.error);
