
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const tasks = query("SELECT preset_id, COUNT(*) as count FROM tasks WHERE status = 'pending' GROUP BY preset_id", []);
    console.log('Pending counts by preset:');
    console.log(JSON.stringify(tasks, null, 2));
}

main().catch(console.error);
