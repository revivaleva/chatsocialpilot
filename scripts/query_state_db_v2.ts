import Database from 'better-sqlite3';
import path from 'path';

const globalDbPath = 'C:\\Users\\Administrator\\AppData\\Roaming\\Antigravity\\User\\globalStorage\\state.vscdb';

function queryDb(dbPath: string, name: string) {
    console.log(`--- Querying ${name}: ${dbPath} ---`);
    try {
        const db = new Database(dbPath, { readonly: true });
        const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%uss%' OR key LIKE '%agentPreferences%' OR key LIKE '%policy%'").all();
        rows.forEach(r => {
            console.log(`KEY: ${r.key}`);
            console.log(`VALUE: ${r.value}`);
            console.log('---');
        });
        db.close();
    } catch (e) {
        console.error(`Error querying ${name}: ${e}`);
    }
}

queryDb(globalDbPath, "Global Storage");
