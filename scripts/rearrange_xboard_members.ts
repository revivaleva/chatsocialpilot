
import { initDb, query, run } from "../src/drivers/db";

async function main() {
    initDb();

    const targetUsernames = [
        "an_cosme_beauty", "miyu_biyou", "iroyuru_", "kui_nyan_", "miyu_bgnr",
        "hana_beatbabe", "rin_g_bx", "nemu_bloom", "hinata_w_cosme", "n7_cos",
        "c1115Sarah", "rutho0vazy0", "donna2010ir2lzv", "momoka_coswalk",
        "onaka_no_yuki", "ElizabethG76409", "barbara1fz0w3n", "carolr7ew8st",
        "mochiko_diett", "ricochan_diet", "idol_dol1920"
    ].map(u => u.toLowerCase());

    console.log(`Targeting ${targetUsernames.length} accounts to move to XBoard.`);

    // 1. Get Group IDs
    const xBoardGroup = query("SELECT id FROM container_groups WHERE name = ?", ["XBoard"])[0] as any;
    const xHeitaiGroup = query("SELECT id FROM container_groups WHERE name = ?", ["X兵隊"])[0] as any;

    if (!xBoardGroup || !xHeitaiGroup) {
        console.error("Group XBoard or X兵隊 not found.");
        return;
    }

    console.log(`XBoard Group ID: ${xBoardGroup.id}`);
    console.log(`X兵隊 Group ID: ${xHeitaiGroup.id}`);

    // 2. Find all current accounts and their usernames
    const allAccounts = query("SELECT container_id, x_username FROM x_accounts", []) as any[];

    const targetsToMoveToXBoard: string[] = [];
    for (const acc of allAccounts) {
        const username = (acc.x_username || "").toLowerCase();
        const cid = (acc.container_id || "").toLowerCase();
        if (targetUsernames.some(u => username === u || cid === u)) {
            targetsToMoveToXBoard.push(acc.container_id); // This is XID
        }
    }

    console.log(`Found ${targetsToMoveToXBoard.length} matching accounts in x_accounts to move to XBoard.`);

    // 3. Move target accounts to XBoard
    const now = Date.now();
    for (const cid of targetsToMoveToXBoard) {
        run(`
            INSERT INTO container_group_members(container_id, group_id, created_at, updated_at)
            VALUES(?,?,?,?)
            ON CONFLICT(container_id) DO UPDATE SET group_id=excluded.group_id, updated_at=excluded.updated_at
        `, [cid, xBoardGroup.id, now, now]);
        console.log(`Moved ${cid} to XBoard.`);
    }

    // 4. Move other accounts OUT of XBoard (and into X兵隊)
    // Find who is currently in XBoard
    const currentXBoardMembers = query(`
        SELECT container_id FROM container_group_members WHERE group_id = ?
    `, [xBoardGroup.id]) as any[];

    let movedCount = 0;
    for (const member of currentXBoardMembers) {
        const cid = member.container_id;
        if (!targetsToMoveToXBoard.includes(cid)) {
            // Move to X兵隊
            run(`
                UPDATE container_group_members
                SET group_id = ?, updated_at = ?
                WHERE container_id = ? AND group_id = ?
            `, [xHeitaiGroup.id, now, cid, xBoardGroup.id]);
            console.log(`Moved ${cid} from XBoard to X兵隊.`);
            movedCount++;
        }
    }
    console.log(`\nCompleted. Relocated ${movedCount} non-listed accounts from XBoard to X兵隊.`);
}

main().catch(console.error);
