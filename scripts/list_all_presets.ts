
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('--- All Presets ---');
    const presets = query('SELECT id, name FROM presets ORDER BY id');
    console.log(JSON.stringify(presets, null, 2));
}

main().catch(console.error);
