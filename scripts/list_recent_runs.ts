import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('\nMost recent task runs:');
    const runs = query('SELECT * FROM task_runs ORDER BY id DESC LIMIT 20', []);
    for (const r of runs) {
        console.log(`ID: ${r.id}, RunID: ${r.runId}, Status: ${r.status}, Started: ${r.started_at ? new Date(r.started_at).toISOString() : null}`);
    }
}

main().catch(console.error);
