
import { setExecutionEnabled, ALL_QUEUE_NAMES } from '../src/services/taskQueue.js';
import { initDb, run as dbRun } from '../src/drivers/db.js';

async function main() {
    initDb();
    console.log('Stopping all workers...');
    for (const queueName of ALL_QUEUE_NAMES) {
        console.log(`Disabling execution for ${queueName}...`);
        setExecutionEnabled(false, queueName);
    }

    // Also mark running tasks as 'stopped' in the DB
    console.log('Marking running tasks as stopped...');
    const now = Date.now();
    const result = dbRun("UPDATE tasks SET status = 'stopped', updated_at = ? WHERE status = 'running'", [now]);
    console.log(`Updated ${result.changes} tasks to 'stopped' status.`);

    console.log('All execution stopped.');
}

main().catch(console.error);
