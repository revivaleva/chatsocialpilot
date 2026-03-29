
import { initDb, query } from '../src/drivers/db.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

async function main() {
    initDb();

    // 1. X兵隊グループのIDを取得
    const groups = query<any>("SELECT id FROM container_groups WHERE name = 'X兵隊'", []);
    if (groups.length === 0) {
        console.error("Group 'X兵隊' not found in app.db");
        return;
    }
    const groupId = groups[0].id;
    console.log(`Target Group ID: ${groupId}`);

    // 2. グループメンバーを取得
    const members = query<any>("SELECT container_id FROM container_group_members WHERE group_id = ?", [groupId]);
    const dbContainerIds = members.map(m => String(m.container_id));
    console.log(`Total members in DB: ${dbContainerIds.length}`);

    // 3. コンテナブラウザのDBパスを特定
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const cbDbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');

    if (!fs.existsSync(cbDbPath)) {
        console.error(`Container Browser DB not found at: ${cbDbPath}`);
        return;
    }
    console.log(`Container Browser DB: ${cbDbPath}`);

    // 4. コンテナブラウザのコンテナ一覧を取得
    const cbDb = new Database(cbDbPath, { readonly: true });
    const cbContainers = cbDb.prepare("SELECT id, name FROM containers").all() as any[];
    cbDb.close();

    const cbIdSet = new Set(cbContainers.map(c => String(c.id)));
    const cbNameSet = new Set(cbContainers.map(c => String(c.name)));
    console.log(`Total containers in CB: ${cbContainers.length}`);

    // 5. 照合
    const missing: string[] = [];
    const found: string[] = [];

    for (const id of dbContainerIds) {
        if (cbIdSet.has(id) || cbNameSet.has(id)) {
            found.push(id);
        } else {
            missing.push(id);
        }
    }

    console.log("\n--- Result ---");
    console.log(`Matched: ${found.length}`);
    console.log(`Missing: ${missing.length}`);

    if (missing.length > 0) {
        console.log("\n--- Missing Containers ---");
        missing.forEach(id => console.log(id));
    } else {
        console.log("\nAll X-Heitai containers exist in Container Browser.");
    }
}

main().catch(console.error);
