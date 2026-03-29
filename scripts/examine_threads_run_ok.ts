
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const runs = query(`
        SELECT tr.runId, tr.status, tr.result_json, t.overrides_json
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28 AND tr.status = 'ok'
        LIMIT 1
    `);

    if (runs.length > 0) {
        console.log("RunId:", runs[0].runId);
        console.log("Overrides:", runs[0].overrides_json);
        const res = JSON.parse(runs[0].result_json);
        console.log("Result JSON structure keys:", Object.keys(res));
        if (res.gatheredVars) {
            console.log("GatheredVars keys:", Object.keys(res.gatheredVars));
            console.log("pr_save_result:", JSON.stringify(res.gatheredVars.pr_save_result, null, 2));
        }
    } else {
        console.log("No 'ok' runs found for preset 28.");
    }
}

main().catch(console.error);
