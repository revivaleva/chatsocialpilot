
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const tasks = query("SELECT queue_name, COUNT(*) as count FROM tasks WHERE status = 'pending' AND preset_id = 29 GROUP BY queue_name", []);
    console.log('Pending tasks for Preset 29:');
    console.log(JSON.stringify(tasks, null, 2));
}

main().catch(console.error);
