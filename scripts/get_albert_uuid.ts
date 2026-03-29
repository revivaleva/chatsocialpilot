
import { loadSettings } from "../src/services/appSettings.js";

async function main() {
    const settings = await loadSettings();
    const host = process.env.CONTAINER_BROWSER_HOST || settings.containerBrowserHost || '127.0.0.1';
    const port = settings.containerBrowserPort || 3002;
    const url = `http://${host}:${port}/internal/containers/list`;
    const res = await fetch(url);
    const data = await res.json() as any;
    const albert = data.containers.find(c => c.name === 'AlbertEbne87131');
    console.log(JSON.stringify(albert, null, 2));
}

main().catch(console.error);
