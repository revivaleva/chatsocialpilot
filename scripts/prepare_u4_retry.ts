
import { initDb, query } from '../src/drivers/db.js';
import fs from 'fs';

async function main() {
    initDb();
    const previous606 = query("SELECT container_id, queue_name FROM tasks WHERE preset_id = 606");
    const tasks = previous606.map(t => ({
        presetId: 606,
        containerId: t.container_id,
        queueName: t.queue_name
    }));
    fs.writeFileSync('tasks_u4_retry.json', JSON.stringify(tasks, null, 2));
    console.log("Prepared " + tasks.length + " retry tasks for U4 in tasks_u4_retry.json");
}

main().catch(console.error);
