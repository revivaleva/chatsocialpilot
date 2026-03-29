
import { initDb, query } from '../src/drivers/db.js';
import fs from 'fs';

async function main() {
    initDb();
    const groupId = "6df1aacd-4623-4908-9e2d-9fa1d9990109";

    const usedContainers = query("SELECT DISTINCT container_id FROM tasks WHERE runId LIKE 'run-60%'");
    const usedIds = usedContainers.map(c => c.container_id);

    const members = query("SELECT container_id FROM container_group_members WHERE group_id = ?", [groupId]);
    const memberIds = members.map(m => m.container_id);

    const availableIds = memberIds.filter(id => !usedIds.includes(id));

    const placeholders = availableIds.map(() => "?").join(",");
    const accounts = query("SELECT container_id, proxy_id FROM x_accounts WHERE container_id IN (" + placeholders + ")", availableIds);

    const byProxy: Record<string, any[]> = {};
    accounts.forEach(a => {
        if (!byProxy[a.proxy_id]) byProxy[a.proxy_id] = [];
        byProxy[a.proxy_id].push(a);
    });

    const plan = [
        { presetId: 605, count: 30 },
        { presetId: 606, count: 20 }
    ];

    const tasks: any[] = [];
    const queueIds = [2, 3, 4, 5, 6, 7, 8, 9];
    let qIdx = 0;

    const proxies = Object.keys(byProxy);

    for (const group of plan) {
        for (let i = 0; i < group.count; i++) {
            const proxyId = proxies.find(p => byProxy[p].length > 0);
            if (!proxyId) break;

            const account = byProxy[proxyId].pop();
            const queueId = queueIds[qIdx % queueIds.length];

            tasks.push({
                presetId: group.presetId,
                containerId: account.container_id,
                queueName: "queue" + queueId
            });

            qIdx++;
        }
    }

    fs.writeFileSync('tasks_extra_heitai.json', JSON.stringify(tasks, null, 2));
    console.log("Prepared " + tasks.length + " tasks in tasks_extra_heitai.json");
}

main().catch(console.error);
