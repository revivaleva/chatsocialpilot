
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const runId = 'run-28-2026-03-14T10-50-36-284Z-106632';

    console.log(`Investigating task status for runId: ${runId}`);

    // 1. Check current task status
    const task = query(`SELECT * FROM tasks WHERE runId = ?`, [runId])[0] as any;
    if (!task) {
        console.log(`Task not found for runId: ${runId}`);
        return;
    }
    console.log('Task Details:', JSON.stringify(task, null, 2));

    // 2. Check execution logs (if any)
    const logs = query(`SELECT * FROM execution_logs WHERE runId = ? ORDER BY created_at DESC LIMIT 50`, [runId]);
    console.log(`\nFound ${logs.length} logs for this task.`);
    logs.slice(0, 10).forEach((l: any) => {
        console.log(`[${new Date(l.created_at).toISOString()}] ${l.event_name}: ${l.payload_json}`);
    });
}

main().catch(console.error);
