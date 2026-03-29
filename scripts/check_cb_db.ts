import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function checkDb(dbPath: string) {
    if (!fs.existsSync(dbPath)) {
        console.log(`File not found: ${dbPath}`);
        return;
    }
    console.log(`\n--- Checking ${dbPath} ---`);
    const db = new Database(dbPath, { readonly: true });
    try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        console.log('Tables:', tables.map((t: any) => t.name).join(', '));

        const presetTable = tables.find(t => t.name === 'presets' || t.name === 'preset');
        if (presetTable) {
            const allPresets = db.prepare(`SELECT * FROM ${presetTable.name}`).all();
            console.log('All Presets:', JSON.stringify(allPresets, null, 2));

            const rolexPresets = db.prepare(`SELECT * FROM ${presetTable.name} WHERE name LIKE '%rolex%' OR name LIKE '%ロレックス%'`).all();
            console.log('Rolex Presets:', JSON.stringify(rolexPresets, null, 2));
        }
    } catch (e) {
        console.error(`Error checking ${dbPath}:`, e);
    } finally {
        db.close();
    }
}

async function main() {
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const cbDbPath = path.join(appdata, 'container-browser', 'data.db');
    await checkDb(cbDbPath);

    // Also check for 3002 instance if it exists in a different folder?
    // Usually instances might share or have separate folders.
}

main().catch(console.error);
