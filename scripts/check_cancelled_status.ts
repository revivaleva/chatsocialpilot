
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const queues = ["queue2", "queue3", "queue4", "queue5", "queue6", "queue7", "queue8", "queue9"];
    const statusCounts = query(`
        SELECT status, count(*) as count 
        FROM tasks 
        WHERE queue_name IN (${queues.map(q => `'${q}'`).join(',')}) 
        GROUP BY status
    `, []);
    console.log('Task Statuses in Queues 2-9:');
    console.log(JSON.stringify(statusCounts, null, 2));
}

main().catch(console.error);
