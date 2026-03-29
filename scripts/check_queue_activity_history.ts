
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const results = query(`
        SELECT t.queue_name, COUNT(*) as count 
        FROM task_runs tr
        JOIN tasks t ON tr.task_id = t.id
        WHERE t.queue_name IN ('queue2', 'queue3', 'queue4', 'queue5', 'queue6', 'queue7', 'queue8', 'queue9')
        GROUP BY t.queue_name
    `, []);
    console.log('Task runs by queue:');
    console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
