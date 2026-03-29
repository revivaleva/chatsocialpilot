
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const runs = query(`
        SELECT tr.runId, tr.result_json
        FROM task_runs tr
        JOIN tasks t ON tr.runId = t.runId
        WHERE t.preset_id = 28 AND tr.status = 'ok'
        LIMIT 1
    `);

    if (runs.length > 0) {
        const res = JSON.parse(runs[0].result_json);
        console.log("Step 1 (For loop) summary:");
        const forStep = res.steps[1];
        if (forStep) {
            console.log("Type:", forStep.type);
            console.log("Iterations count:", forStep.iterations?.length);
            if (forStep.iterations && forStep.iterations.length > 0) {
                const firstIter = forStep.iterations[0];
                console.log("First iteration result values:", firstIter.map((s: any) => s.result));
            }
        }
    }
}

main().catch(console.error);
