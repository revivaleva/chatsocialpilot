
import { initDb, query } from '../src/drivers/db.js';
import { evalInContext } from '../src/drivers/browser.js';

async function main() {
    initDb();
    const gid = '6df1aacd-4623-4908-9e2d-9fa1d9990109';
    const accounts = query('SELECT container_id FROM container_group_members WHERE group_id = ?', [gid]) as any[];

    let activeCount = 0;
    console.log(`Probing ${accounts.length} accounts for active windows...`);

    // Check in parallel batches of 50 to be fast
    const batchSize = 50;
    for (let i = 0; i < accounts.length; i += batchSize) {
        const batch = accounts.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async (acc) => {
            try {
                const res = await evalInContext(acc.container_id, '1', { timeoutMs: 500 });
                return res.ok;
            } catch (e) { return false; }
        }));
        activeCount += results.filter(r => r).length;
    }

    console.log(`TOTAL_ACTIVE_WINDOWS: ${activeCount}`);
}

main().catch(console.error);
