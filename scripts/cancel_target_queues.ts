
import { initDb, run as dbRun } from '../src/drivers/db.js';

async function main() {
    initDb();
    const targetQueues = ["queue2", "queue3", "queue4", "queue5", "queue6", "queue7", "queue8", "queue9"];

    console.log('Cancelling tasks in queues 2-9...');
    const now = Date.now();

    // Update both 'pending' and 'running' to 'stopped'
    const result = dbRun(`
        UPDATE tasks 
        SET status = 'stopped', updated_at = ? 
        WHERE queue_name IN (?, ?, ?, ?, ?, ?, ?, ?)
        AND status IN ('pending', 'running')
    `, [now, ...targetQueues]);

    console.log(`Successfully cancelled ${result.changes} tasks in queues 2-9.`);
}

main().catch(console.error);
