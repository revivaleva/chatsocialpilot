
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const statuses = query("SELECT status, COUNT(*) as count FROM tasks GROUP BY status", []);
    console.log('Task Statuses:');
    console.log(JSON.stringify(statuses, null, 2));

    const recentRuns = query("SELECT runId, status, started_at, ended_at FROM task_runs ORDER BY started_at DESC LIMIT 5", []);
    console.log('Recent Task Runs:');
    console.log(JSON.stringify(recentRuns, null, 2));
}

main().catch(console.error);
