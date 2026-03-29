
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const tasks = query("SELECT runId, queue_name, status FROM tasks WHERE status = 'running'", []);
    console.log('Currently running tasks:');
    console.log(JSON.stringify(tasks, null, 2));
}

main().catch(console.error);
