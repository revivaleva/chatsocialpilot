
import fetch from 'node-fetch';

async function main() {
    try {
        const listRes = await fetch('http://127.0.0.1:3002/internal/containers/list');
        const data: any = await listRes.json();
        const list = data.containers || [];

        console.log(`Force closing ${list.length} containers...`);
        let closedCount = 0;
        let errorCount = 0;

        for (const c of list) {
            try {
                const res = await fetch('http://127.0.0.1:3002/internal/export-restored/close', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: c.id })
                });
                if (res.ok) closedCount++; else errorCount++;
            } catch (e) {
                errorCount++;
            }
            if ((closedCount + errorCount) % 100 === 0) {
                console.log(`Progress: ${closedCount + errorCount} / ${list.length}`);
                // Tiny delay to avoid overwhelming the server
                await new Promise(r => setTimeout(r, 100));
            }
        }
        console.log(`Finished. Closed: ${closedCount}, Errors: ${errorCount}`);
    } catch (e: any) {
        console.error('Fatal:', e.message);
    }
}

main();
