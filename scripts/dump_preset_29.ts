
import { initDb, query } from '../src/drivers/db.js';
import fs from 'node:fs';

async function main() {
    initDb();
    const rows = query('SELECT steps_json FROM presets WHERE id = 29', []);
    if (rows.length > 0) {
        fs.writeFileSync('preset_29_steps.json', rows[0].steps_json, 'utf8');
        console.log('Dumped steps of Preset 29 to preset_29_steps.json');
    }
}

main().catch(console.error);
