
import { initDb, query } from '../src/drivers/db.js';
import fs from 'fs';

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
        const structure = {
            runId: run.runId,
            steps_count: res.steps?.length,
            step1: res.steps && res.steps.length > 1 ? res.steps[1] : null
        };
        fs.writeFileSync('result_sample.json', JSON.stringify(structure, null, 2));
        console.log("Written to result_sample.json");
    }
}

main().catch(console.error);
