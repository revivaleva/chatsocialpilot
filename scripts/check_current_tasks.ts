
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const counts = query("SELECT status, COUNT(*) as count FROM tasks WHERE runId LIKE 'run-60%' GROUP BY status");
    console.log('Task status counts:');
    console.log(JSON.stringify(counts, null, 2));

    const failed = query("SELECT runId, status, container_id FROM tasks WHERE runId LIKE 'run-60%' AND status IN ('failed', 'waiting_failed', 'stopped') LIMIT 10");
    console.log('Sample failed/stopped tasks:');
    console.log(JSON.stringify(failed, null, 2));
}

main().catch(console.error);
