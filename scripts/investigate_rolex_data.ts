import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('--- Tables ---');
    const tables = query("SELECT name FROM sqlite_master WHERE type='table'");
    console.log(tables.map(t => t.name).join(', '));

    console.log('\n--- Rolex-related Presets ---');
    const rolexPresets = query("SELECT id, name FROM presets WHERE name LIKE '%rolex%' OR name LIKE '%ロレックス%'");
    console.log(JSON.stringify(rolexPresets, null, 2));

    console.log('\n--- Rolex-related Tasks ---');
    const rolexTasks = query("SELECT id, preset_id, container_id FROM tasks WHERE overrides_json LIKE '%rolex%' OR overrides_json LIKE '%ロレックス%'");
    console.log(JSON.stringify(rolexTasks, null, 2));

    console.log('\n--- Checking for specialized Rolex tables ---');
    const rolexTables = tables.filter(t => t.name.toLowerCase().includes('rolex'));
    if (rolexTables.length > 0) {
        console.log('Found Rolex-specific tables:', rolexTables.map(t => t.name));
        for (const table of rolexTables) {
            const count = query(`SELECT COUNT(*) as count FROM ${table.name}`)[0].count;
            console.log(`Table ${table.name} has ${count} rows`);
        }
    } else {
        console.log('No Rolex-specific tables found.');
    }
}

main().catch(console.error);
