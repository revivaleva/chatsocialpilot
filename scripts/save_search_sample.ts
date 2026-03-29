
import { initDb, query } from '../src/drivers/db.js';
import fs from 'fs';

async function main() {
    initDb();

    const runs = query(`
        SELECT tr.runId, tr.result_json, t.overrides_json
        FROM task_runs tr
        JOIN tasks t ON tr.unId = t.runId
        WHERE t.preset_id = 28 AND tr.status = 'ok'
        LIMIT 1
    `);

    if (runs.length > 0) {
        const run = runs[0];
        const res = JSON.parse(run.result_json);
        const structure = {
            runId: run.runId,
            keyword: JSON.parse(run.overrides_json).keyword,
            firstIterationSearch: res.steps[1].result.iterations[0][0].result.body.result
        };
        fs.writeFileSync('search_sample.json', JSON.stringify(structure, null, 2));
    }
}

main().catch(console.error);
