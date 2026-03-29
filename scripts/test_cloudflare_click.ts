
import { createContainer, execInContainer, evalInContext } from '../src/drivers/browser';
import { initDb, query } from '../src/drivers/db';

async function main() {
    initDb();
    const name = 'JohnDav23449715';

    // 1. Get account and proxy info
    const acc = (query('SELECT * FROM x_accounts WHERE container_id = ?', [name]) as any[])[0];
    if (!acc) {
        console.error(`Account not found: ${name}`);
        return;
    }

    const proxyRow = (query('SELECT * FROM proxies WHERE id = ?', [acc.proxy_id]) as any[])[0];
    let proxy: any = null;
    if (proxyRow) {
        const parts = proxyRow.proxy_info.split(':');
        if (parts.length === 4) {
            proxy = { server: `${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
        } else {
            console.warn(`Unexpected proxy format: ${proxyRow.proxy_info}`);
        }
    }

    // 2. Open Container & Navigate
    console.log(`Starting Cloudflare Click Test for: ${name} (Proxy: ${proxyRow?.proxy_info})`);
    const openRes = await createContainer({ name, proxy });
    const internalId = openRes.containerId; // This is the UUID
    console.log(`Internal ID: ${internalId}`);

    console.log("Injecting cookies...");
    await execInContainer(internalId, 'navigate', { url: 'https://x.com' });
    await new Promise(r => setTimeout(r, 6000));

    await evalInContext(internalId, `
        (function() {
            function setCookie(n, v) {
                document.cookie = n + "=" + v + "; domain=.x.com; path=/; SameSite=Lax; Secure; expires=Fri, 31 Dec 2030 23:59:59 GMT";
            }
            setCookie('auth_token', '${acc.auth_token}');
            setCookie('ct0', '${acc.ct0}');
        })()
    `);

    console.log("Navigating to home (waiting for Cloudflare)...");
    await execInContainer(internalId, 'navigate', { url: 'https://x.com/home' });
    await new Promise(r => setTimeout(r, 12000));

    // Capture initial state
    const state = await execInContainer(internalId, 'eval', { eval: "({ url: window.location.href, html: document.body.innerHTML })" }, { screenshot: true });
    console.log(`Current URL: ${state.url}, Screenshot: ${state.screenshotPath}`);

    if (!(state.result?.html || "").includes('Cloudflare') && !(state.result?.html || "").includes('セキュリティ検証')) {
        console.warn("Cloudflare challenge NOT detected in HTML. Script may fail.");
    }

    // 2. Locate Cloudflare Widget
    console.log("Locating Cloudflare elements...");
    // Try multiple possible selectors for the Turnstile widget
    const rectRes = await execInContainer(internalId, 'getElementRect', {
        selector: 'iframe[src*="cloudflare"], div[id^="cf-"], div#AOzYg6, #challenge-stage'
    });

    if (!rectRes.ok || !rectRes.target) {
        console.error("Could not locate Cloudflare widget via selector. Falling back to default center coordinates.");
        // Defaults if detection fails (usually around center of screen)
        const x = 300;
        const y = 300;
        await performSimulatedClick(internalId, x, y);
    } else {
        const { x, y, width, height } = rectRes.target as any;
        console.log(`Widget found at: x=${x}, y=${y}, w=${width}, h=${height}`);

        // Target: left 1/4 (width is usually 300px, so 75px from left of widget)
        const targetX = x + (width / 5); // Aiming for center of checkbox on left
        const targetY = y + (height / 2);

        await performSimulatedClick(internalId, targetX, targetY);
    }

    // 3. Wait and check
    console.log("Waiting 30s to see if challenge clears...");
    await new Promise(r => setTimeout(r, 10000));

    const intermediateState = await execInContainer(internalId, 'eval', { eval: "window.location.href" }, { screenshot: true });
    console.log(`Intermediate URL: ${intermediateState.result}, Screenshot: ${intermediateState.screenshotPath}`);

    await new Promise(r => setTimeout(r, 20000));
    const finalState = await execInContainer(internalId, 'eval', { eval: "({ url: window.location.href, title: document.title })" }, { screenshot: true });
    console.log(`Final URL: ${finalState.result?.url}, Title: ${finalState.result?.title}, Screenshot: ${finalState.screenshotPath}`);

    if (finalState.result?.url.includes('home')) {
        console.log("SUCCESS: Cloudflare bypassed and reached home!");
    } else {
        console.log("FAILED: Still not at home. Check final screenshot.");
    }
}

async function performSimulatedClick(internalId: string, tx: number, ty: number) {
    console.log(`Simulating click at (${tx}, ${ty}) with human-like entry.`);

    // A. Initial jump to edge
    await execInContainer(internalId, 'mouseMove', { x: 0, y: Math.max(0, ty - 100) });
    await new Promise(r => setTimeout(r, 800));

    // B. Human-like movement to target (increased steps for smoothness)
    const moveRes = await execInContainer(internalId, 'mouseMove', { x: tx, y: ty }, { steps: 35 } as any);
    console.log(`Move result: ${moveRes.ok}`);
    await new Promise(r => setTimeout(r, 400));

    // C. Click with small release delay
    const clickRes = await execInContainer(internalId, 'mouseClick', { x: tx, y: ty, delayMs: 180 } as any);
    console.log(`Click result: ${clickRes.ok}`);
}

main().catch(console.error);
