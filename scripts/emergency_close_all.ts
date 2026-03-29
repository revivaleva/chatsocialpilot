
import { loadSettings } from "../src/services/appSettings.js";
import { evalInContext, closeContainer } from "../src/drivers/browser.js";

async function main() {
    const settings = await loadSettings();
    const host = process.env.CONTAINER_BROWSER_HOST || settings.containerBrowserHost || '127.0.0.1';
    const port = settings.containerBrowserPort || 3002;
    const url = `http://${host}:${port}/internal/containers/list`;
    const res = await fetch(url);
    const data = await res.json() as any;
    const containers = data.containers || [];

    console.log(`Probing ${containers.length} containers...`);

    // Probing in parallel
    const batchSize = 100;
    for (let i = 0; i < containers.length; i += batchSize) {
        const batch = containers.slice(i, i + batchSize);
        await Promise.all(batch.map(async (c) => {
            try {
                const probe = await evalInContext(c.id, '1', { timeoutMs: 500 });
                if (probe.ok) {
                    console.log(`Closing active container: ${c.id} (${c.name})`);
                    await closeContainer({ id: c.id });
                }
            } catch (e) { }
        }));
    }
    console.log('Cleanup complete.');
}

main().catch(console.error);
