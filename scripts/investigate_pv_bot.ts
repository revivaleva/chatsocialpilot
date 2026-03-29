import { createContainer, closeContainer, navigateInContext, evalInContext } from "../src/drivers/browser.js";
import { randomUUID } from "node:crypto";
import { initDb } from "../src/drivers/db.js";

async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log("Starting PV Bot investigation script...");
    initDb();

    const containerName = `pv-test-${randomUUID().slice(0, 8)}`;
    console.log(`[PV-BOT] Creating container with blockImages: true... (${containerName})`);

    const createResult = await createContainer({
        name: containerName,
        blockImages: true
    });

    if (!createResult.ok) {
        console.error("[PV-BOT] Failed to create container:", createResult.message);
        return;
    }

    const containerId = createResult.containerId;
    console.log(`[PV-BOT] Container created successfully. ID: ${containerId}`);

    const targetUrls = [
        "https://ja.wikipedia.org/wiki/%E3%83%A1%E3%82%A4%E3%83%B3%E3%83%9A%E3%83%BC%E3%82%B8", // Wikipedia
        "https://example.com"
    ];

    try {
        for (const url of targetUrls) {
            console.log(`\n[PV-BOT] Navigating to: ${url}`);
            const t0 = Date.now();
            const navResult = await navigateInContext(containerId, url);
            const t1 = Date.now();

            if (!navResult.ok) {
                console.error(`[PV-BOT] Navigation failed for ${url}:`, navResult);
                continue;
            }

            console.log(`[PV-BOT] Navigation succeeded. Loading time: ${t1 - t0}ms`);

            console.log(`[PV-BOT] Simulating page stay (3 seconds)...`);
            await wait(3000);

            // 스크롤 시뮬レーション 등..
            console.log(`[PV-BOT] Checking if images were blocked...`);
            const checkScript = `
        (() => {
          const imgs = Array.from(document.querySelectorAll('img'));
          let loadedCount = 0;
          let sources = [];
          imgs.forEach(img => {
            if (img.complete && img.naturalHeight > 0 && !img.src.startsWith('data:')) {
              loadedCount++;
              sources.push(img.src);
            }
          });
          return { totalImages: imgs.length, loadedImages: loadedCount, sources: sources.slice(0, 5) };
        })();
      `;


            const evalOut = await evalInContext(containerId, checkScript, { returnHtml: false });
            if (evalOut.ok) {
                console.log(`[PV-BOT] Image check result: ${JSON.stringify(evalOut.result)}`);
            } else {
                console.log(`[PV-BOT] Failed to evaluate image block status.`);
            }
        }
    } finally {
        console.log(`\n[PV-BOT] Cleaning up... Closing container ${containerId}`);
        const closeResult = await closeContainer({ id: containerId });
        console.log(`[PV-BOT] Container closed: ${closeResult.ok}`);
    }
}

main().catch(console.error);
