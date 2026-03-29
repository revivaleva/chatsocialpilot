
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const tasks = query("SELECT runId, scheduled_at, created_at, status, queue_name FROM tasks WHERE status = 'pending' AND preset_id = 29 LIMIT 5", []);
    console.log('Sample PENDING tasks for Preset 29:');
    console.log(JSON.stringify(tasks, null, 2));
    console.log(`Current time: ${Date.now()}`);
}

main().catch(console.error);
