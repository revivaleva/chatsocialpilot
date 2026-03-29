
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // 1. Get ALL accounts from x_accounts
    const allAccounts = query(`
        SELECT container_id, x_username
        FROM x_accounts
    `, []) as any[];

    console.log(`Total accounts in x_accounts: ${allAccounts.length}`);

    // List of usernames to exclude
    const excludeUsernames = [
        "an_cosme_beauty", "miyu_biyou", "iroyuru_", "kui_nyan_", "miyu_bgnr",
        "hana_beatbabe", "rin_g_bx", "nemu_bloom", "hinata_w_cosme", "n7_cos",
        "c1115Sarah", "rutho0vazy0", "donna2010ir2lzv", "momoka_coswalk",
        "onaka_no_yuki", "ElizabethG76409", "barbara1fz0w3n", "carolr7ew8st",
        "mochiko_diett", "ricochan_diet", "idol_dol1920"
    ].map(u => u.toLowerCase());

    const excludedFound: any[] = [];
    const others: any[] = [];

    for (const row of allAccounts) {
        const username = (row.x_username || "").toLowerCase();
        if (excludeUsernames.includes(username)) {
            excludedFound.push(row);
        } else {
            others.push(row);
        }
    }

    console.log(`\n### Username Match Result ###`);
    console.log(`Total Accounts Checked: ${allAccounts.length}`);
    console.log(`Exclusion List Matches Found: ${excludedFound.length}`);

    if (excludedFound.length > 0) {
        excludedFound.forEach(a => console.log(`- @${a.x_username} (Container: ${a.container_id})`));
    }

    // Identify which groups these accounts belong to
    console.log(`\n### Group Distribution for ALL accounts ###`);
    const groupDist = query(`
        SELECT cg.name, count(*) as count
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        GROUP BY cg.name
    `, []) as any[];
    console.table(groupDist);
}

main().catch(console.error);
