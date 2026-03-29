
import fetch from 'node-fetch';

async function main() {
    try {
        const res = await fetch('http://127.0.0.1:3002/internal/containers/list');
        const json = await res.json();
        console.log(JSON.stringify(json, null, 2));
    } catch (e: any) {
        console.error('Failed to fetch container list:', e.message);
    }
}

main();
