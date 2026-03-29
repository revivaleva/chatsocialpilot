
import fetch from 'node-fetch';

async function main() {
    try {
        const res = await fetch('http://127.0.0.1:3002/internal/containers/list');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: any = await res.json();
        const containers = data.containers || [];
        console.log(`CURRENT_CONTAINER_COUNT: ${containers.length}`);
    } catch (e: any) {
        console.error('Failed:', e.message);
    }
}

main();
