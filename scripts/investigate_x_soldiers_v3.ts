
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // 1. Get ALL accounts from x_accounts including those without group
    const allAccounts = query(`
        SELECT xa.container_id, xa.x_username, cg.name as group_name
        FROM x_accounts xa
        LEFT JOIN container_group_members cgm ON xa.container_id = cgm.container_id
        LEFT JOIN container_groups cg ON cgm.group_id = cg.id
    `, []) as any[];

    console.log(`Total accounts in x_accounts: ${allAccounts.length}`);

    // List of usernames to exclude
    const excludeUsernames = [
        "an_cosme_beauty", "miyu_biyou", "iroyuru_", "kui_nyan_", "miyu_bgnr",
        "hana_beatbabe", "rin_g_bx", "nemu_bloom", "hinata_w_cosme", "n7_cos",
        "c1115Sarah", "rutho0vazy0", "donna2010ir2lzv", "momoka_coswalk",
        "onaka_no_yuki", "ElizabethG76409", "barbara1fz0w3n", "carolr7ew8st",
        "mochiko_diett", "ricochan_diet", "idol_dol1920"
    ].map(u => u.toLowerCase().replace(/_/g, "")); // Try removing underscores for matching too

    const excludedFound: any[] = [];
    const others: any[] = [];

    for (const row of allAccounts) {
        const username = (row.x_username || "").toLowerCase();
        const strippedUsername = username.replace(/_/g, "");

        if (excludeUsernames.includes(username) || excludeUsernames.includes(strippedUsername)) {
            excludedFound.push(row);
        } else {
            others.push(row);
        }
    }

    console.log(`\n### Username Match Result (Fuzzy) ###`);
    console.log(`Exclusion List Matches Found: ${excludedFound.length}`);

    if (excludedFound.length > 0) {
        excludedFound.forEach(a => console.log(`- @${a.x_username} (Group: ${a.group_name || 'No Group'}, Container: ${a.container_id})`));
    }

    const noGroupCount = allAccounts.filter(a => !a.group_name).length;
    console.log(`\nAccounts with NO group: ${noGroupCount}`);

    if (noGroupCount > 0) {
        console.log(`Example accounts without group:`);
        allAccounts.filter(a => !a.group_name).slice(0, 10).forEach(a => console.log(`- @${a.x_username} (${a.container_id})`));
    }
}

main().catch(console.error);
