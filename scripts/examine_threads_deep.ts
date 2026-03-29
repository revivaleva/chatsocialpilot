
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
        console.log("Steps summary:");
        res.steps.forEach((s: any, i: number) => {
            console.log(`Step ${i}:`, JSON.stringify({
                type: s.type,
                description: s.description,
                hasIterations: !!s.iterations,
                iterationsCount: s.iterations?.length,
                resultVar: s.result_var
            }));
        });

        // Let's look deeper into the for step if it exists
        const forStep = res.steps.find((s: any) => s.iterations);
        if (forStep && forStep.iterations.length > 0) {
            console.log("\nFirst iteration sample step 1 (Save posts) result:");
            const lastInnerStep = forStep.iterations[0][1]; // Inner step 1 is saving
            console.log(JSON.stringify(lastInnerStep.result, null, 2));
        }
    }
}

main().catch(console.error);
