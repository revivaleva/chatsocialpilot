
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';

async function main() {
    // Determine userData path (Standard Electron path on Windows)
    const userData = path.join(os.homedir(), 'AppData', 'Roaming', 'container-browser-for-kameleo');
    const dbPath = path.join(userData, 'data.db');

    console.log('Connecting to app database at:', dbPath);
    const db = new Database(dbPath);

    const name = 'SBneder60540';
    const row = db.prepare('SELECT id FROM containers WHERE name = ?').get(name) as any;

    if (row) {
        console.log(`Deleting container ${name} (id: ${row.id}) from app database...`);
        db.prepare('DELETE FROM tabs WHERE containerId = ?').run(row.id);
        db.prepare('DELETE FROM sessions WHERE containerId = ?').run(row.id);
        db.prepare('DELETE FROM credentials WHERE containerId = ?').run(row.id);
        db.prepare('DELETE FROM site_prefs WHERE containerId = ?').run(row.id);
        db.prepare('DELETE FROM containers WHERE id = ?').run(row.id);
        console.log('Deleted successfully.');
    } else {
        console.log(`Container ${name} not found in app database.`);
    }

    db.close();
}

main().catch(console.error);
