
import { initDb, query } from '../src/drivers/db.js';
import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

async function main() {
    initDb();

    // 1. Get Group ID for X兵隊
    const groups = query<any>("SELECT id FROM container_groups WHERE name = 'X兵隊'", []);
    if (groups.length === 0) {
        console.error("Group 'X兵隊' not found");
        return;
    }
    const xHeitaiGroupId = groups[0].id;

    // 2. Get member names/IDs
    const xHeitaiMembers = query<any>("SELECT container_id FROM container_group_members WHERE group_id = ?", [xHeitaiGroupId]);
    const xHeitaiIds = xHeitaiMembers.map(m => String(m.container_id));

    // 3. Get Threads containers
    const threadsContainers = ['loureiroalbuquerqueqd556', '6cb7bb29-0d43-4d3e-8575-a4aee3313d5e'];

    // 4. Connect to Container Browser DB
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const cbDbPath = process.env.DEFAULT_CB_DB || path.join(appData, 'container-browser', 'data.db');
    const cbDb = new Database(cbDbPath, { readonly: true });

    // Create a mapping Name -> ID and ID -> Name
    const cbContainers = cbDb.prepare("SELECT id, name FROM containers").all() as any[];
    cbDb.close();

    const nameToUuid: Record<string, string> = {};
    const uuidToName: Record<string, string> = {};
    for (const c of cbContainers) {
        nameToUuid[String(c.name)] = String(c.id);
        uuidToName[String(c.id)] = String(c.name);
    }

    // 5. Generate List
    const result: Array<{ name: string, uuid: string, type: string }> = [];

    // Threads
    for (const nameOrUuid of threadsContainers) {
        let name = "";
        let uuid = "";
        if (uuidToName[nameOrUuid]) {
            uuid = nameOrUuid;
            name = uuidToName[nameOrUuid];
        } else if (nameToUuid[nameOrUuid]) {
            name = nameOrUuid;
            uuid = nameToUuid[nameOrUuid];
        } else {
            console.warn(`Threads container not found in CB: ${nameOrUuid}`);
            continue;
        }
        result.push({ name, uuid, type: 'Threads' });
    }

    // X-Heitai
    for (const nameOrUuid of xHeitaiIds) {
        let name = "";
        let uuid = "";
        if (uuidToName[nameOrUuid]) {
            uuid = nameOrUuid;
            name = uuidToName[nameOrUuid];
        } else if (nameToUuid[nameOrUuid]) {
            name = nameOrUuid;
            uuid = nameToUuid[nameOrUuid];
        } else {
            console.warn(`X-Heitai container not found in CB: ${nameOrUuid}`);
            continue;
        }
        result.push({ name, uuid, type: 'X-Heitai' });
    }

    // Sort result
    result.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

    // Output to a file
    const outputLines: string[] = ["# コンテナ UUID リスト", ""];
    outputLines.push("| カテゴリ | コンテナ名 (Name) | ID (UUID) |");
    outputLines.push("| :--- | :--- | :--- |");
    for (const item of result) {
        outputLines.push(`| ${item.type} | ${item.name} | ${item.uuid} |`);
    }

    fs.writeFileSync('scripts/container-uuid-list.md', outputLines.join('\n'), 'utf8');
    console.log("Generated scripts/container-uuid-list.md");
}

main().catch(console.error);
