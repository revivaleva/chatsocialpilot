
import { loadSettings } from '../src/services/appSettings.js';

async function main() {
    const s = loadSettings();
    const url = `http://127.0.0.1:${s.containerBrowserPort}/api/v1/containers`;
    console.log(`Fetching containers from ${url}...`);
    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            console.log('Containers:', JSON.stringify(data, null, 2));
        } else {
            console.log(`HTTP Error: ${response.status} ${response.statusText}`);
        }
    } catch (e) {
        console.error('Fetch Error:', e);
    }
}

main().catch(console.error);
