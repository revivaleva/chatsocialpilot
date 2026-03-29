
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('Listing all Preset IDs:');
    const allPresets = query(`SELECT id, name FROM presets`);
    console.table(allPresets);

    console.log('\nChecking tasks for queue_name = "queue10":');
    const q10Tasks = query(`SELECT id, preset_id, container_id, status, created_at FROM tasks WHERE queue_name = 'queue10' ORDER BY id DESC LIMIT 10`);
    console.table(q10Tasks);

    if (q10Tasks.length > 0) {
        const firstPresetId = q10Tasks[0].preset_id;
        console.log(`\nInvestigating Preset ID ${firstPresetId} (found in queue10)...`);
        const p = query(`SELECT * FROM presets WHERE id = ?`, [firstPresetId])[0] as any;
        if (p) {
            console.log(`Name: ${p.name}`);
            // console.log(`Steps: ${p.steps_json}`);
        } else {
            console.log(`Preset ID ${firstPresetId} NOT FOUND in presets table (dangling reference?).`);
        }
    }

    console.log('\nChecking container_group_members for any group mentioning 10:');
    const groupMembers = query(`
        SELECT cgm.*, cg.name as group_name 
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.name LIKE '%10%' OR cg.id LIKE '%10%'
    `);
    console.table(groupMembers);
}

main().catch(console.error);
