
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const runIds = [
        'run-601-2026-03-22T21-14-45-733Z-780037',
        'run-602-2026-03-22T21-14-45-734Z-442604',
        'run-603-2026-03-22T21-14-45-734Z-739851',
        'run-604-2026-03-22T21-14-45-734Z-632880'
    ];

    for (const id of runIds) {
        console.log('--- Log for ' + id + ' ---');
        const runs = query("SELECT runId, status, result_json FROM task_runs WHERE runId = ?", [id]);
        console.log(JSON.stringify(runs, null, 2));

        const history = query("SELECT capability_key, outcome, result_json, latency_ms FROM run_history WHERE run_id = ? ORDER BY id", [id]);
        console.log('History:');
        console.log(JSON.stringify(history, null, 2));
    }
}

main().catch(console.error);
