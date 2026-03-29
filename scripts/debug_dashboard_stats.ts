
import { initDb, query } from "../src/drivers/db";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";

function defaultContainerDb() {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return process.env.DEFAULT_CB_DB || path.join(appData, "container-browser", "data.db");
}

async function main() {
    initDb();

    // 1. Get target groups
    const targetGroups = query("SELECT id, name FROM container_groups WHERE name LIKE ?", ["X兵隊%"]) as any[];
    const targetGroupIds = targetGroups.map((g) => g.id);
    console.log(`Target groups: ${targetGroups.map(g => g.name).join(", ")}`);

    // 2. Get target container IDs from group members
    const placeholders = targetGroupIds.map(() => "?").join(",");
    const members = query(
        `SELECT DISTINCT container_id FROM container_group_members WHERE group_id IN (${placeholders})`,
        targetGroupIds
    ) as { container_id: string }[];

    const targetContainerUuids = new Set(members.map(m => String(m.container_id)));
    console.log(`Members in group: ${targetContainerUuids.size}`);

    // Peek at some members
    const samples = Array.from(targetContainerUuids).slice(0, 5);
    console.log(`Sample member IDs from DB: ${samples.join(", ")}`);

    // 3. Resolve to XIDs (Dashboard logic)
    let targetContainerIds: Set<string> = new Set();
    const dbPath = defaultContainerDb();
    if (fs.existsSync(dbPath)) {
        console.log(`Using container DB: ${dbPath}`);
        const containerDb = new Database(dbPath, { readonly: true });
        const containers = containerDb.prepare("SELECT id, name FROM containers").all() as any[];
        containerDb.close();

        for (const c of containers) {
            const cid = String(c.id || ""); // UUID
            const cname = String(c.name || ""); // XID
            if (targetContainerUuids.has(cid)) {
                if (cname) targetContainerIds.add(cname);
            }
        }
    }
    console.log(`Resolved XIDs (Dashboard logic): ${targetContainerIds.size}`);

    // 4. Proposed fix logic: If targetContainerUuids.has(cname) or targetContainerUuids.has(cid)
    let fixedTargetContainerIds: Set<string> = new Set();
    if (fs.existsSync(dbPath)) {
        const containerDb = new Database(dbPath, { readonly: true });
        const containers = containerDb.prepare("SELECT id, name FROM containers").all() as any[];
        containerDb.close();

        for (const c of containers) {
            const cid = String(c.id || ""); // UUID
            const cname = String(c.name || ""); // XID
            if (targetContainerUuids.has(cid) || targetContainerUuids.has(cname)) {
                if (cname) fixedTargetContainerIds.add(cname);
            }
        }
    }
    console.log(`Resolved XIDs (Fixed logic): ${fixedTargetContainerIds.size}`);

    // 5. Final account count
    if (fixedTargetContainerIds.size > 0) {
        const idList = Array.from(fixedTargetContainerIds);
        const qPlaceholders = idList.map(() => "?").join(",");
        const result = query(`SELECT COUNT(*) as count FROM x_accounts WHERE container_id IN (${qPlaceholders})`, idList) as any[];
        console.log(`Account count in x_accounts: ${result[0].count}`);
    }
}

main().catch(console.error);
