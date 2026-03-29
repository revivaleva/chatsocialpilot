
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const runIds = [
        'run-601-2026-03-22T21-14-45-733Z-780037',
        'run-602-2026-03-22T21-14-45-734Z-442604',
        'run-603-2026-03-22T21-14-45-734Z-739851',
        'run-604-2026-03-22T21-14-45-734Z-632880'
    ];

    const results = query("SELECT runId, status FROM tasks WHERE runId IN (?,?,?,?)", runIds);
    console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
