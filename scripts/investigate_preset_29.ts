import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const presets = query('SELECT * FROM presets WHERE id = 29');
    console.log('Preset 29:', JSON.stringify(presets, null, 2));

    const xheitaiGroup = query("SELECT * FROM container_groups WHERE name LIKE '%X兵隊%'");
    console.log('X-Heitai Groups:', JSON.stringify(xheitaiGroup, null, 2));
}

main().catch(console.error);
