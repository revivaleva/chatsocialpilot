
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('Last 5 completed tasks in queue10:');
    const tasks = query(`SELECT runId, status, updated_at, overrides_json FROM tasks WHERE queue_name = 'queue10' AND status = 'done' ORDER BY updated_at DESC LIMIT 5`);
    tasks.forEach((t: any) => {
        const overrides = JSON.parse(t.overrides_json);
        console.log(`[${t.status}] Keyword: ${overrides.keyword}, runId: ${t.runId}, Finished: ${new Date(t.updated_at).toISOString()}`);
    });

    console.log('\nCurrent status of queue10:');
    const queueStatus = query(`SELECT status, count(*) as count FROM tasks WHERE queue_name = 'queue10' GROUP BY status`);
    console.log(queueStatus);
}

main().catch(console.error);
