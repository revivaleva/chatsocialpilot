
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('Investigating Preset 10...');
    const preset10 = query(`SELECT * FROM presets WHERE id = 10`)[0] as any;
    if (preset10) {
        console.log(`Preset 10: ${preset10.name}`);
        console.log(`Description: ${preset10.description}`);
        // console.log(`Steps: ${preset10.steps_json}`);
    } else {
        console.log('Preset 10 not found.');
    }

    console.log('\nChecking for tasks associated with Preset 10 to identify container...');
    const tasks10 = query(`SELECT container_id, COUNT(*) as count FROM tasks WHERE preset_id = 10 GROUP BY container_id`);
    console.table(tasks10);

    console.log('\nRecalling Preset 28 for comparison (the one we fixed):');
    const preset28 = query(`SELECT id, name FROM presets WHERE id = 28`)[0] as any;
    console.log(`Preset 28: ${preset28?.name}`);
}

main().catch(console.error);
