
import { initDb, query, run as dbRun } from '../src/drivers/db.js';

async function main() {
    initDb();
    const targetQueues = ["queue2", "queue3", "queue4", "queue5", "queue6", "queue7", "queue8", "queue9"];

    // Check if they are Preset 29
    const presets = query(`
        SELECT preset_id, count(*) as count 
        FROM tasks 
        WHERE status = 'stopped' AND queue_name IN (${targetQueues.map(q => `'${q}'`).join(',')}) 
        GROUP BY preset_id
    `, []);
    console.log('Stopped tasks breakdown:', JSON.stringify(presets, null, 2));

    // Completely remove them from the tasks table (This "deletes" them from the Task List in Dashboard)
    console.log('Deleting tasks from the active queue list...');
    const result = dbRun(`
        DELETE FROM tasks 
        WHERE status = 'stopped' AND queue_name IN (${targetQueues.map(q => `'${q}'`).join(',')})
    `, []);

    console.log(`Successfully removed ${result.changes} tasks from the active task list.`);
}

main().catch(console.error);
