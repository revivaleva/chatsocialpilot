
import { initDb, query } from "../src/drivers/db";
import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

async function main() {
    initDb();

    // Container Browser DB path
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const cbDbPath = path.join(appData, "container-browser", "data.db");

    if (!fs.existsSync(cbDbPath)) {
        console.error("Container Browser DB not found at:", cbDbPath);
        return;
    }

    const cbDb = new Database(cbDbPath, { readonly: true });

    // Try to join the two DBs if possible, or just fetch map from CB DB
    console.log("### Fetching UUID <-> Name map from Container Browser DB ###");
    const containerMap = cbDb.prepare("SELECT id, name FROM containers").all() as { id: string, name: string }[];
    const uuidToName = new Map(containerMap.map(c => [c.id, c.name]));

    console.log(`Loaded ${containerMap.length} containers from CB DB.`);

    // Now check all members in 'X兵隊' groups
    const xSoldierGroups = query("SELECT id, name FROM container_groups WHERE name LIKE '%X兵隊%'", []) as any[];

    console.log("\n### X Soldier Group Member Resolution ###");
    let grandTotal = 0;
    for (const group of xSoldierGroups) {
        const members = query("SELECT container_id FROM container_group_members WHERE group_id = ?", [group.id]) as any[];
        const resolvedNames = members.map(m => uuidToName.get(m.container_id) || m.container_id);

        console.log(`Group: ${group.name} (${group.id}) | Members: ${members.length}`);
        if (members.length > 0) {
            console.log("  Sample names:", resolvedNames.slice(0, 5).join(", "));
        }
        grandTotal += members.length;
    }
    console.log(`\nGrand Total Resolved: ${grandTotal}`);

    cbDb.close();
}

main().catch(console.error);
