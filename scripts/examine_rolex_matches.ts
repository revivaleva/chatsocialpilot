import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const term = '田中';

    console.log('--- Tasks matching 田中 ---');
    const tasks = query(`SELECT t.*, p.name as preset_name FROM tasks t LEFT JOIN presets p ON t.preset_id = p.id WHERE t.overrides_json LIKE '%${term}%'`);
    console.log(JSON.stringify(tasks, null, 2));

    console.log('\n--- Task Runs matching 田中 ---');
    const taskRuns = query(`SELECT tr.*, p.name as preset_name FROM task_runs tr JOIN tasks t ON tr.task_id = t.id LEFT JOIN presets p ON t.preset_id = p.id WHERE tr.result_json LIKE '%${term}%' LIMIT 5`);
    console.log(JSON.stringify(taskRuns, null, 2));
}

main().catch(console.error);
