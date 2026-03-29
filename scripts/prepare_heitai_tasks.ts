
import fs from 'node:fs';
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const testRunRows = query("SELECT container_id FROM tasks WHERE runId LIKE 'run-601%' OR runId LIKE 'run-602%' OR runId LIKE 'run-603%' OR runId LIKE 'run-604%'");
    const usedContainers = new Set(testRunRows.map(r => r.container_id));

    const hAccs = query(" \
    SELECT x.container_id, x.proxy_id \
    FROM x_accounts x \
    JOIN container_group_members cgm ON x.container_id = cgm.container_id \
    JOIN container_groups cg ON cgm.group_id = cg.id \
    WHERE cg.name = 'X兵隊' \
  ");

    const available = hAccs.filter(a => !usedContainers.has(a.container_id));
    console.log('Available accounts:', available.length);

    const proxyGroups: Record<string, any[]> = {};
    for (const acc of available) {
        const pid = acc.proxy_id || 'null';
        if (!proxyGroups[pid]) proxyGroups[pid] = [];
        proxyGroups[pid].push(acc);
    }

    const sortedProxies = Object.keys(proxyGroups).sort((a, b) => proxyGroups[b].length - proxyGroups[a].length);

    const remaining = {
        601: 19,
        602: 9,
        603: 119,
        604: 49
    };

    const pool: number[] = [];
    Object.entries(remaining).forEach(([pid, count]) => {
        for (let i = 0; i < count; i++) pool.push(Number(pid));
    });

    // Shuffle pool
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const targetQueues = ['queue2', 'queue3', 'queue4', 'queue5', 'queue6', 'queue7', 'queue8', 'queue9'];
    const queueBuckets: Record<string, any[]> = {};
    targetQueues.forEach(q => queueBuckets[q] = []);

    // 1. プロキシバランスを保ちながら252アカウントを8つのキューに分配
    let qIdx = 0;
    for (const pid of sortedProxies) {
        const targetQ = targetQueues[qIdx % targetQueues.length];
        queueBuckets[targetQ].push(...proxyGroups[pid]);
        qIdx++;
    }

    // 2. 各キューから均等に 196 / 8 = 24.5 件ずつ取り出す
    const finalTasks: any[] = [];
    const tasksPerQueue = Math.floor(196 / targetQueues.length);
    let extras = 196 % targetQueues.length;

    for (const q of targetQueues) {
        const limit = tasksPerQueue + (extras > 0 ? 1 : 0);
        if (extras > 0) extras--;

        const accs = queueBuckets[q];
        for (let i = 0; i < Math.min(accs.length, limit); i++) {
            if (pool.length > 0) {
                finalTasks.push({
                    presetId: pool.pop(),
                    containerId: accs[i].container_id,
                    queueName: q,
                    overrides: {}
                });
            }
        }
    }

    console.log('Tasks prepared:', finalTasks.length);
    fs.writeFileSync('tasks_to_register_heitai.json', JSON.stringify(finalTasks, null, 2));
}

main().catch(console.error);
