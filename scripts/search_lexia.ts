import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const term = 'lexia';
    console.log(`--- Searching for ${term} ---`);
    const presets = query(`SELECT id, name FROM presets WHERE steps_json LIKE '%${term}%' OR name LIKE '%${term}%'`);
    console.log('Presets:', JSON.stringify(presets, null, 2));

    const tasks = query(`SELECT id, preset_id, container_id FROM tasks WHERE overrides_json LIKE '%${term}%'`);
    console.log('Tasks:', JSON.stringify(tasks, null, 2));
}

main().catch(console.error);
