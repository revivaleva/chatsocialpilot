import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const term = '田中';

    console.log('--- Tasks matching 田中 (Detailed) ---');
    const tasks = query(`SELECT t.id, t.preset_id, t.overrides_json, p.name as preset_name FROM tasks t LEFT JOIN presets p ON t.preset_id = p.id WHERE t.overrides_json LIKE '%${term}%'`);
    tasks.forEach(t => {
        console.log(`Task ID: ${t.id}, Preset: ${t.preset_name}`);
        console.log(`Overrides: ${t.overrides_json}`);
    });

    console.log('\n--- Post Library matching 田中 ---');
    const posts = query(`SELECT * FROM post_library WHERE content LIKE '%${term}%'`);
    console.log(JSON.stringify(posts, null, 2));
}

main().catch(console.error);
