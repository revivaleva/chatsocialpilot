
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const runs = query(`
        SELECT tr.runId, tr.result_json, t.overrides_json
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28 AND tr.status = 'ok'
        LIMIT 1
    `);

    if (runs.length > 0) {
        const run = runs[0];
        const res = JSON.parse(run.result_json);
        console.log("Step 1 (For loop) Result.body Sample (2000 chars):", JSON.stringify(res.steps[1].result, null, 2).substring(0, 2000));
        // let's try to see if result.body actually contains anything.
    }
}

main().catch(console.error);
