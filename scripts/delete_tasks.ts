
import { initDb, query, run } from "../src/drivers/db";
import fs from "node:fs";
import path from "node:path";

async function main() {
    initDb();

    const dates = ['2026-03-24', '2026-03-26'];
    let totalDeleted = 0;

    // Snapshot first
    const dbPath = path.resolve("storage", "app.db");
    const snapPath = path.resolve("storage", "snapshots", `backup-before-delete-${Date.now()}.db`);
    if (!fs.existsSync(path.dirname(snapPath))) {
        fs.mkdirSync(path.dirname(snapPath), { recursive: true });
    }
    fs.copyFileSync(dbPath, snapPath);
    console.log(`DB snapshot created: ${snapPath}`);

    for (const dateStr of dates) {
        const start = new Date(dateStr + 'T00:00:00+09:00').getTime();
        const end = new Date(dateStr + 'T23:59:59+09:00').getTime();

        // First, count them to double verify
        const countRow = query<{ count: number }>(
            'SELECT COUNT(*) as count FROM tasks WHERE scheduled_at BETWEEN ? AND ?',
            [start, end]
        );
        const count = countRow[0].count;
        console.log(`${dateStr}: Found ${count} tasks to delete.`);

        if (count > 0) {
            // Find the tasks to delete related runs
            const taskIds = query<{ id: number; runId: string }>(
                'SELECT id, runId FROM tasks WHERE scheduled_at BETWEEN ? AND ?',
                [start, end]
            );

            const ids = taskIds.map(t => t.id);
            const runIds = taskIds.map(t => t.runId).filter(id => !!id);

            // Deletion
            // Delete task_runs
            if (runIds.length > 0) {
                const resultRun = run(`DELETE FROM task_runs WHERE runId IN (${runIds.map(() => '?').join(',')})`, runIds);
                console.log(`  Deleted ${resultRun.changes} associated task_runs.`);
            }

            // Delete tasks
            const resultTask = run(
                'DELETE FROM tasks WHERE scheduled_at BETWEEN ? AND ?',
                [start, end]
            );
            console.log(`  Deleted ${resultTask.changes} tasks.`);
            totalDeleted += resultTask.changes;
        }
    }

    console.log(`Total tasks deleted: ${totalDeleted}`);
}

main().catch(console.error);
