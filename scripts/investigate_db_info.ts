import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const presets = query('SELECT id, name FROM presets');
    for (const p of presets) {
        console.log(`${p.id}: ${p.name}`);
    }
}

main().catch(console.error);
