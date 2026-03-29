
import { loadSettings } from "../src/services/appSettings.js";

async function main() {
    const settings = await loadSettings();
    const host = process.env.CONTAINER_BROWSER_HOST || settings.containerBrowserHost || '127.0.0.1';
    const port = settings.containerBrowserPort || 3001;
    const url = `http://${host}:${port}/internal/containers/list`;
    const res = await fetch(url);
    const data = await res.json() as any;
    const mary = data.containers.find(c => c.id === '89d9ba54-ec7a-4d87-9cc4-431fc29638cb');
    console.log(JSON.stringify(mary, null, 2));
}

main().catch(console.error);
