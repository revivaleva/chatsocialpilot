
import { initDb, query, memGet } from '../src/drivers/db.js';

async function main() {
    initDb();
    const queues = ['default', 'queue2', 'queue3', 'queue4', 'queue5', 'queue6', 'queue7', 'queue8', 'queue9', 'queue10'];
    console.log('Task Execution Status:');
    for (const q of queues) {
        const enabled = memGet(`executionEnabled_${q}`);
        console.log(`Queue: ${q}, Enabled: ${enabled}`);
    }
}

main().catch(console.error);
