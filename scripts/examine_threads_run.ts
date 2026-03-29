
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const runs = query(`
        SELECT tr.runId, tr.status, tr.result_json, t.overrides_json
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28 AND tr.status = 'completed'
        LIMIT 1
    `);

    if (runs.length > 0) {
        console.log("RunId:", runs[0].runId);
        console.log("Overrides:", runs[0].overrides_json);
        console.log("Result JSON (partial):", JSON.stringify(JSON.parse(runs[0].result_json), null, 2).substring(0, 1000));
    } else {
        console.log("No completed runs found for preset 28.");
    }
}

main().catch(console.error);
