
import { initDb, query } from '../src/drivers/db.js';
import fs from 'node:fs';

async function main() {
    initDb();

    console.log('Checking Preset 28 steps_json...');
    const p28 = query(`SELECT steps_json FROM presets WHERE id = 28`)[0] as any;
    if (p28) {
        fs.writeFileSync('preset_28_steps.json', p28.steps_json);
        console.log('Saved to preset_28_steps.json');
    } else {
        console.log('Preset 28 not found.');
    }
}

main().catch(console.error);
