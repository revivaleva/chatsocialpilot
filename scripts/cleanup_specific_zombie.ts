import { initDb, run, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const runId = 'run-28-2026-03-14T10-50-36-284Z-106632';

    console.log(`Cleaning up zombie task: ${runId}`);

    const task = query('SELECT id, status, container_id FROM tasks WHERE runId = ?', [runId])[0] as any;
    if (!task) {
        console.log('Task not found.');
        return;
    }

    if (task.status !== 'running' && task.status !== 'stopped') {
        console.log(`Task status is ${task.status}, no cleanup needed.`);
    } else {
        const now = Date.now();
        run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['failed', now, task.id]);
        console.log(`Updated tasks table status to failed.`);

        try {
            run('UPDATE task_runs SET status = ?, ended_at = ? WHERE runId = ?', ['failed', now, runId]);
            console.log(`Updated task_runs table status to failed.`);
        } catch (e) {
            console.log('task_runs entry might not exist.');
        }
    }
}

main().catch(console.error);
