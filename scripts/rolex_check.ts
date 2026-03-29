
import { initDb } from "../src/drivers/db.js";
import { createContainer, execInContainer, deleteContainer, getPageHtml } from "../src/drivers/browser.js";
import fs from "fs";

async function main() {
    // initDb(); // Not needed for simple browser check if we don't use proxies from DB

    const urls = [
        "https://reservation.rolexboutique-omotesando-tokyo.jp/omotesando/reservation?func_distinction=1",
        "https://reservation.rolexboutique-lexia.jp/ginza/reservation",
        "https://reservation.rolexboutique-lexia.jp/shinjuku/reservation",
        "https://reservation.rolexboutique-lexia.jp/nagoya-sakae/reservation"
    ];

    const containerId = "rolex-investigation-" + Date.now();
    console.log("Creating container...");
    const createRes = await createContainer({ name: containerId });
    if (!createRes.ok) {
        console.error("Failed to create container:", createRes.message);
        return;
    }

    const cid = createRes.containerId;

    for (const url of urls) {
        console.log(`Navigating to ${url}...`);
        const navRes = await execInContainer(cid, "navigate", { url });
        if (!navRes.ok) {
            console.error(`Failed to navigate to ${url}:`, navRes.errorDetail?.message);
            continue;
        }

        // Wait a bit for rendering
        await new Promise(r => setTimeout(r, 5000));

        console.log(`Capturing HTML/Screenshot for ${url}...`);
        const htmlRes = await getPageHtml(cid, true);
        const ssRes = await execInContainer(cid, "eval", { eval: "null" }, { screenshot: true });

        if (htmlRes.ok && htmlRes.html) {
            const fileName = `notes/rolex_${url.split('/').pop()?.split('?')[0] || 'site'}.html`;
            // fs.writeFileSync(fileName, htmlRes.html);
            // console.log(`Saved HTML to ${fileName}`);

            // Just log summary of fields
            const fields = htmlRes.html.match(/id="[^"]+"/g);
            console.log(`Found IDs:`, fields?.slice(0, 20));
        }

        if (ssRes.ok && ssRes.screenshotPath) {
            console.log(`Screenshot for ${url}: ${ssRes.screenshotPath}`);
        }
    }

    console.log("Deleting container...");
    await deleteContainer(cid);
}

main().catch(console.error);
