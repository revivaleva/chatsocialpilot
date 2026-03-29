
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();
    const rows = query('SELECT steps_json FROM presets WHERE id = 29', []);
    if (rows && rows.length > 0) {
        console.log('Preset 29 steps_json:');
        console.log(JSON.stringify(JSON.parse((rows[0] as any).steps_json), null, 2));
    } else {
        console.log('Preset 29 not found');
    }
}

main().catch(console.error);
