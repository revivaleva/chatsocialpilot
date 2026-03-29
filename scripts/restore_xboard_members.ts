
import { initDb, query, run } from "../src/drivers/db";
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

    // 1. Group IDs
    const xBoardGroup = query("SELECT id FROM container_groups WHERE name = ?", ["XBoard"])[0] as any;
    const xHeitaiGroup = query("SELECT id FROM container_groups WHERE name = ?", ["X兵隊"])[0] as any;

    if (!xBoardGroup || !xHeitaiGroup) {
        console.error("Groups not found.");
        return;
    }

    const now = Date.now();

    // 2. Restore the 20 accounts moved to X兵隊 back to XBoard
    // x_accounts.last_group_name might have 'XBoard' if they were moved by system before? 
    // But I moved them manually.
    // I previously logged them. Let's find them by 'X兵隊' group but NOT being X-heitai named?
    // Actually, I can just look for accounts that were in XBoard previously if I have a log.
    // I'll look for the 20 I moved in the previous step.
    // Their UUIDs were in the log: b18d48f2-9a28-4237-9cc0-10bdf76cd0c5, 83a30897-782c-4c1b-8f64-dd81957c6a48, etc.

    // Simplest: Anyone who was moved to X兵隊 today (or very recently) but doesn't look like X-heitai?
    // Or just move ALL currently in XBoard plus those I moved out back.

    // I will search for the missing 4 in the container DB first.
    const missing = ["onaka_no_yuki", "mochiko_diett", "ricochan_diet", "idol_dol1920"];
    const dbPath = defaultContainerDb();
    let foundMissingIds: string[] = [];
    if (fs.existsSync(dbPath)) {
        const containerDb = new Database(dbPath, { readonly: true });
        for (const m of missing) {
            const row = containerDb.prepare("SELECT id, name FROM containers WHERE name LIKE ?").get(`%${m}%`) as any;
            if (row) {
                foundMissingIds.push(row.name);
                console.log(`Found missing account: ${row.name} (${row.id})`);
            }
        }
        containerDb.close();
    }

    // 3. Move the missing ones to XBoard
    for (const id of foundMissingIds) {
        run(`
            INSERT INTO container_group_members(container_id, group_id, created_at, updated_at)
            VALUES(?,?,?,?)
            ON CONFLICT(container_id) DO UPDATE SET group_id=excluded.group_id, updated_at=excluded.updated_at
        `, [id, xBoardGroup.id, now, now]);
        console.log(`Moved missing ${id} to XBoard.`);
    }

    // 4. Move the 20 accounts back to XBoard.
    // I'll identify them as accounts in X兵隊 that have UUID-like container_id.
    // (X兵隊 accounts use XID naming pattern mostly)
    const xHeitaiMembers = query("SELECT container_id FROM container_group_members WHERE group_id = ?", [xHeitaiGroup.id]) as any[];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let restoredCount = 0;
    for (const m of xHeitaiMembers) {
        if (uuidRegex.test(m.container_id)) {
            run(`UPDATE container_group_members SET group_id = ?, updated_at = ? WHERE container_id = ?`, [xBoardGroup.id, now, m.container_id]);
            console.log(`Restored ${m.container_id} to XBoard.`);
            restoredCount++;
        }
    }
    console.log(`Restored ${restoredCount} accounts to XBoard.`);
}

main().catch(console.error);
