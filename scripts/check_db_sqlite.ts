import Database from 'better-sqlite3';
import fs from 'fs';

async function checkDb(path: string) {
    if (!fs.existsSync(path)) {
        console.log(`File not found: ${path}`);
        return;
    }
    console.log(`\n--- Checking ${path} ---`);
    const db = new Database(path, { readonly: true });
    try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        console.log('Tables:', tables.map((t: any) => t.name).join(', '));

        const presetTable = tables.find(t => t.name === 'presets' || t.name === 'preset');
        if (presetTable) {
            const rolexPresets = db.prepare(`SELECT * FROM ${presetTable.name} WHERE name LIKE '%rolex%' OR name LIKE '%ロレックス%'`).all();
            console.log('Rolex Presets:', JSON.stringify(rolexPresets, null, 2));

            if (rolexPresets.length === 0) {
                const stepCol = db.prepare(`PRAGMA table_info(${presetTable.name})`).all().find(c => c.name.includes('step') || c.name.includes('json'));
                if (stepCol) {
                    const rolexUrls = db.prepare(`SELECT * FROM ${presetTable.name} WHERE ${stepCol.name} LIKE '%rolex%'`).all();
                    console.log('Presets with Rolex URLs:', JSON.stringify(rolexUrls, null, 2));
                }
            }
        }
    } catch (e) {
        console.error(`Error checking ${path}:`, e);
    } finally {
        db.close();
    }
}

async function main() {
    await checkDb('db.sqlite');
}

main().catch(console.error);
