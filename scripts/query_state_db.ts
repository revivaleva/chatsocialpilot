import Database from 'better-sqlite3';
import path from 'path';

const globalDbPath = 'C:\\Users\\Administrator\\AppData\\Roaming\\Antigravity\\User\\globalStorage\\state.vscdb';

function queryDb(dbPath: string, name: string) {
    console.log(`--- Querying ${name}: ${dbPath} ---`);
    try {
        const db = new Database(dbPath, { readonly: true });
        const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%Policy%' OR key LIKE '%terminal%' OR key LIKE '%artifact%' OR key LIKE '%javascript%' OR key LIKE '%agent%'").all();
        console.log(JSON.stringify(rows, null, 2));
        db.close();
    } catch (e) {
        console.error(`Error querying ${name}: ${e}`);
    }
}

queryDb(globalDbPath, "Global Storage");

// Also check workspace storage if we can find the right one
const workspaceIds = ['4710c5583202aa5c4ece399cf6d34f5a', '578cfad007a0135f28dfe1159b1254b0'];
for (const id of workspaceIds) {
    const wsDbPath = path.join('C:\\Users\\Administrator\\AppData\\Roaming\\Antigravity\\User\\workspaceStorage', id, 'state.vscdb');
    queryDb(wsDbPath, `Workspace ${id}`);
}
