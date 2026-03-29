
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { initDb, query } from "../src/drivers/db";

function defaultContainerDb() {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return process.env.DEFAULT_CB_DB || path.join(appData, "container-browser", "data.db");
}

async function main() {
    initDb();

    // Copy-paste logic from server.ts /api/statistics for verification
    const targetGroups = query(
        "SELECT id, name FROM container_groups WHERE name LIKE ? OR name = ?",
        ["X兵隊%", "XBoard"],
    ) as any[];
    const targetGroupIds = targetGroups.map((g) => g.id);

    const members = query(
        `SELECT DISTINCT container_id FROM container_group_members WHERE group_id IN (${targetGroupIds.map(() => "?").join(",")})`,
        targetGroupIds,
    ) as any[];
    const targetContainerUuids = new Set(members.map((m) => String(m.container_id)));

    let targetContainerIds: Set<string> = new Set();
    const dbPath = defaultContainerDb();
    if (fs.existsSync(dbPath)) {
        const containerDb = new Database(dbPath, { readonly: true });
        const containers = containerDb.prepare("SELECT id, name FROM containers").all() as any[];
        containerDb.close();

        for (const c of containers) {
            const cid = String(c.id || ""); // UUID
            const cname = String(c.name || ""); // XID
            if (targetContainerUuids.has(cid) || targetContainerUuids.has(cname)) {
                if (cname) targetContainerIds.add(cname);
            }
        }
    }

    const idList = Array.from(targetContainerIds);
    if (idList.length > 0) {
        const result = query(`SELECT COUNT(*) as count FROM x_accounts WHERE container_id IN (${idList.map(() => "?").join(",")})`, idList) as any[];
        console.log(`Verified statistics account count: ${result[0].count}`);
    } else {
        console.log("Verified statistics account count: 0");
    }
}

main().catch(console.error);
