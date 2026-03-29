import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const urls = [
        'rolexboutique-lexia.jp',
        'rolexboutique-omotesando-tokyo.jp'
    ];

    for (const url of urls) {
        console.log(`--- Searching for ${url} ---`);
        const presets = query(`SELECT id, name FROM presets WHERE steps_json LIKE '%${url}%'`);
        console.log('Presets:', JSON.stringify(presets, null, 2));

        const tasks = query(`SELECT id, preset_id, container_id FROM tasks WHERE overrides_json LIKE '%${url}%'`);
        console.log('Tasks:', JSON.stringify(tasks, null, 2));

        const taskRuns = query(`SELECT id, task_id, result_json FROM task_runs WHERE result_json LIKE '%${url}%' LIMIT 5`);
        console.log('Task Runs (Top 5):', JSON.stringify(taskRuns, null, 2));
    }
}

main().catch(console.error);
