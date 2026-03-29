
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('Checking tasks from the same registration batch...');
    // The registration happened around 2026-03-14T10:50:36Z
    // run-28-2026-03-14T10-50-36-

    const tasks = query(`SELECT runId, status, updated_at, overrides_json FROM tasks WHERE runId LIKE 'run-28-2026-03-14T10-50-36-%' ORDER BY id ASC`);
    console.log(`Found ${tasks.length} tasks.`);

    const stats: Record<string, number> = {};
    tasks.forEach((t: any) => {
        stats[t.status] = (stats[t.status] || 0) + 1;
        const overrides = JSON.parse(t.overrides_json);
        if (t.status === 'running' || t.status === 'pending') {
            console.log(`[${t.status}] Keyword: ${overrides.keyword}, runId: ${t.runId}, Updated: ${new Date(t.updated_at).toISOString()}`);
        }
    });
    console.log('Stats:', stats);
}

main().catch(console.error);
