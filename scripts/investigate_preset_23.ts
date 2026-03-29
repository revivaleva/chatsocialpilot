
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('Investigating Preset 23...');
    const p23 = query(`SELECT * FROM presets WHERE id = 23`)[0] as any;
    if (p23) {
        console.log(`Preset 23: ${p23.name}`);
        console.log(`Description: ${p23.description}`);
    } else {
        console.log('Preset 23 not found.');
    }
}

main().catch(console.error);
