
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
        const res = JSON.parse(runs[0].result_json);
        console.log("Steps keys and structure:");
        res.steps.forEach((s: any, i: number) => {
            console.log(`Step ${i}:`, Object.keys(s));
            if (s.iterations) {
                console.log(`Step ${i} iterations count: ${s.iterations.length}`);
                if (s.iterations.length > 0) {
                    const firstIter = s.iterations[0];
                    console.log(`First iteration element 0 type: ${typeof firstIter[0]}`);
                    console.log(`First iteration element 1 type: ${typeof firstIter[1]}`);
                    console.log(`First iteration element 1 keys:`, Object.keys(firstIter[1] || {}));
                    console.log(`First iteration element 1 result keys:`, Object.keys(firstIter[1]?.result || {}));
                }
            }
        });

        // Let's also look at the 'result_var' which might be on the main 'res'
        console.log("Main result keys:", Object.keys(res));
    }
}

main().catch(console.error);
