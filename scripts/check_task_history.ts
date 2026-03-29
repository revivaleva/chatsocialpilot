import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const batchPrefix = 'run-28-2026-03-14T10-50-36-';
    const tasks: any[] = query('SELECT id, runId, status, updated_at, container_id, queue_name FROM tasks WHERE runId LIKE ? ORDER BY id ASC', [batchPrefix + '%']);

    console.log(`Found ${tasks.length} tasks in batch.`);

    for (const task of tasks) {
        const runs: any[] = query('SELECT id, runId, status, started_at, ended_at FROM task_runs WHERE runId = ?', [task.runId]);
        if (runs.length > 0 || task.status !== 'pending') {
            console.log(`Task: ${task.runId}, Status: ${task.status}, Queue: ${task.queue_name}, Container: ${task.container_id}, Updated: ${new Date(task.updated_at).toISOString()}`);
        }
    }

    console.log('\nListing all container groups...');
    const allGroups: any[] = query('SELECT * FROM container_groups', []);

    for (const group of allGroups) {
        const countRows: any = query('SELECT COUNT(*) as count FROM container_group_members WHERE group_id = ?', [group.id]);
        const count = countRows[0]?.count || 0;
        console.log(`Group: ${group.name} (${group.id}), Member Count: ${count}`);

        if (group.name.toLowerCase().includes('threads') || group.name.toLowerCase().includes('スレッズ')) {
            const members: any[] = query('SELECT * FROM container_group_members WHERE group_id = ?', [group.id]);
            console.log(`  Members of ${group.name}:`);
            for (const m of members) {
                const accounts: any[] = query('SELECT x.container_id, x.proxy_id, p.proxy_info FROM x_accounts x LEFT JOIN proxies p ON x.proxy_id = p.id WHERE x.container_id = ?', [m.container_id]);
                const acc = accounts[0];
                console.log(`    - Container: ${acc?.container_id}, ProxyID: ${acc?.proxy_id}, Proxy: ${acc?.proxy_info}`);
            }
        }
    }
}

main().catch(console.error);
