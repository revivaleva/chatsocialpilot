import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();
    const r = query(`
    SELECT tr.result_json 
    FROM task_runs tr 
    JOIN tasks t ON tr.task_id = t.id 
    WHERE tr.runId LIKE 'run-17-2026-03-10T18-47-%' 
    AND t.status = 'failed'
  `, []) as any[];

    console.log(`Found ${r.length} failed runs.`);
    r.forEach((x, i) => {
        try {
            const res = JSON.parse(x.result_json);
            console.log(`Failure ${i + 1}: ${res.error || 'No error field'}`);
        } catch (e) {
            console.error(`Error parsing JSON for failure ${i + 1}`);
        }
    });
}

main().catch(console.error);
