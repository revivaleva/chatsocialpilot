
import { initDb, query, run } from '../src/drivers/db.js';

async function main() {
    initDb();

    // Target queues: queue2 to queue9 (task2 to task9)
    const targetQueues = [
        'queue2', 'queue3', 'queue4', 'queue5', 'queue6', 'queue7', 'queue8', 'queue9'
    ];

    // 1. Get all pending tasks for preset 29 in default queue
    const tasks = query(`
        SELECT t.id, t.container_id, a.proxy_id 
        FROM tasks t
        LEFT JOIN x_accounts a ON t.container_id = a.container_id
        WHERE t.status = 'pending' 
          AND t.preset_id = 29 
          AND t.queue_name = 'default'
    `, []) as any[];

    console.log(`Found ${tasks.length} tasks to redistribute.`);

    if (tasks.length === 0) return;

    // 2. Group by proxy_id
    const proxyMap = new Map<number | null, any[]>();
    for (const task of tasks) {
        const proxyId = task.proxy_id;
        if (!proxyMap.has(proxyId)) {
            proxyMap.set(proxyId, []);
        }
        proxyMap.get(proxyId)!.push(task);
    }

    console.log(`Proxies involved: ${proxyMap.size}`);

    // 3. Redistribute
    let updatedCount = 0;
    const proxyIds = Array.from(proxyMap.keys()).sort((a, b) => (a || 0) - (b || 0));

    for (let i = 0; i < proxyIds.length; i++) {
        const proxyId = proxyIds[i];
        const groupTasks = proxyMap.get(proxyId)!;

        // Use mod to select a queue from queue2-queue9
        const targetQueue = targetQueues[i % targetQueues.length];

        for (const task of groupTasks) {
            run("UPDATE tasks SET queue_name = ?, updated_at = ? WHERE id = ?", [targetQueue, Date.now(), task.id]);
            updatedCount++;
        }
    }

    console.log(`Successfully redistributed ${updatedCount} tasks into ${targetQueues.length} queues.`);

    // 4. Verify distribution
    const verify = query(`
        SELECT queue_name, COUNT(*) as count 
        FROM tasks 
        WHERE status = 'pending' AND preset_id = 29 
        GROUP BY queue_name
    `, []);
    console.log('Final distribution:');
    console.log(JSON.stringify(verify, null, 2));
}

main().catch(console.error);
