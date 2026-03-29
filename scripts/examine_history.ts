
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const history = query(`
        SELECT runId, event, data_json 
        FROM run_history 
        WHERE runId IN (
            SELECT runId FROM task_runs tr
            JOIN tasks t ON tr.runId = t.runId
            WHERE t.preset_id = 28 AND tr.status = 'ok'
            LIMIT 5
        )
        ORDER BY id ASC
    `);

    console.log("History records for first 5 ok runs:");
    history.forEach((h: any) => {
        console.log(`${h.runId.substring(0, 15)} | ${h.event}`);
    });
}

main().catch(console.error);
