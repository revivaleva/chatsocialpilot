
import fetch from 'node-fetch';

async function main() {
    try {
        const listRes = await fetch('http://127.0.0.1:3002/internal/containers/list');
        const data: any = await listRes.json();
        const list = data.containers || [];

        console.log(`Closing ${list.length} containers...`);
        for (const c of list) {
            console.log(`Closing ${c.id} (${c.name})...`);
            await fetch('http://127.0.0.1:3002/internal/export-restored/close', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: c.id })
            });
        }
        console.log('Done.');
    } catch (e: any) {
        console.error('Failed to close containers:', e.message);
    }
}

main();
