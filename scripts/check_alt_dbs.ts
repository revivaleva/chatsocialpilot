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

        if (tables.some((t: any) => t.name === 'presets')) {
            const rolexPresets = db.prepare("SELECT id, name FROM presets WHERE name LIKE '%rolex%' OR name LIKE '%ロレックス%'").all();
            console.log('Rolex Presets:', JSON.stringify(rolexPresets, null, 2));

            // If no names match, check steps_json for URLs
            if (rolexPresets.length === 0) {
                const rolexUrls = db.prepare("SELECT id, name FROM presets WHERE steps_json LIKE '%rolex%'").all();
                console.log('Presets with Rolex URLs:', JSON.stringify(rolexUrls, null, 2));
            }
        }
    } catch (e) {
        console.error(`Error checking ${path}:`, e);
    } finally {
        db.close();
    }
}

async function main() {
    await checkDb('chatsocialpilot.db');
    await checkDb('data/app.db');
}

main().catch(console.error);
