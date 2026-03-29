
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // 1. Get all containers in groups that have "X兵隊" in their name
    const xSoldierAccountRows = query(`
        SELECT DISTINCT cgm.container_id, xa.x_username
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        LEFT JOIN x_accounts xa ON cgm.container_id = xa.container_id
        WHERE cg.name LIKE '%X兵隊%'
    `, []) as any[];

    console.log(`Total containers in 'X兵隊' groups: ${xSoldierAccountRows.length}`);

    // List of usernames to exclude
    const excludeUsernames = [
        "an_cosme_beauty", "miyu_biyou", "iroyuru_", "kui_nyan_", "miyu_bgnr",
        "hana_beatbabe", "rin_g_bx", "nemu_bloom", "hinata_w_cosme", "n7_cos",
        "c1115Sarah", "rutho0vazy0", "donna2010ir2lzv", "momoka_coswalk",
        "onaka_no_yuki", "ElizabethG76409", "barbara1fz0w3n", "carolr7ew8st",
        "mochiko_diett", "ricochan_diet", "idol_dol1920"
    ].map(u => u.toLowerCase());

    const excludedList: any[] = [];
    const targetList: any[] = [];

    for (const row of xSoldierAccountRows) {
        const username = (row.x_username || "").toLowerCase();
        // Check both username and if the container_id itself contains the exclude string (just in case)
        if (excludeUsernames.includes(username)) {
            excludedList.push(row);
        } else {
            targetList.push(row);
        }
    }

    console.log(`\n### Investigation Result ###`);
    console.log(`Total X Soldier Accounts: ${xSoldierAccountRows.length}`);
    console.log(`Accounts found in Exclusion List: ${excludedList.length}`);
    console.log(`Final Target Accounts: ${targetList.length}`);

    if (excludedList.length > 0) {
        console.log(`\n### Excluded Accounts Found ###`);
        excludedList.forEach(a => console.log(`- @${a.x_username} (Container: ${a.container_id})`));
    } else {
        console.log(`\nNo accounts from the exclusion list were found in the current X Soldier groups.`);
    }

    // Just to be sure, check if any of the target accounts are in the 'Ban' group
    const banGroupRows = query(`SELECT id FROM container_groups WHERE name LIKE '%Ban%' OR name LIKE '%凍結%'`, []) as any[];
    const banGroupIds = banGroupRows.map(g => g.id);

    if (banGroupIds.length > 0) {
        const bannedInTargets = [];
        for (const t of targetList) {
            const membership = query(`SELECT group_id FROM container_group_members WHERE container_id = ?`, [t.container_id]) as any[];
            if (membership.some(m => banGroupIds.includes(m.group_id))) {
                bannedInTargets.push(t.container_id);
            }
        }
        if (bannedInTargets.length > 0) {
            console.log(`\n### Warning: ${bannedInTargets.length} target accounts are in Ban/凍結 groups. (Should probably exclude them too) ###`);
        }
    }
}

main().catch(console.error);
