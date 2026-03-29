import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const runId = 'run-28-2026-03-14T10-50-36-289Z-500026';
    const tasks = query('SELECT * FROM tasks WHERE runId = ?', [runId]);

    if (tasks.length > 0) {
        const task: any = tasks[0];
        console.log('Task Details:', {
            runId: task.runId,
            status: task.status,
            updated_at: new Date(task.updated_at).toISOString(),
            overrides: JSON.parse(task.overrides_json)
        });

        const runs = query('SELECT * FROM task_runs WHERE runId = ? ORDER BY started_at DESC', [runId]);
        console.log('Runs:', runs.map((r: any) => ({
            id: r.id,
            status: r.status,
            started: r.started_at ? new Date(r.started_at).toISOString() : null,
            ended: r.ended_at ? new Date(r.ended_at).toISOString() : null
        })));
    } else {
        console.log('Task not found.');
    }
}

main().catch(console.error);
