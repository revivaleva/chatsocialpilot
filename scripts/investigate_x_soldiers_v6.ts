
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // 1. Get ALL accounts from x_accounts
    const allAccounts = query(`
        SELECT container_id, x_username
        FROM x_accounts
    `, []) as any[];

    const excludeUsernames = [
        "an_cosme_beauty", "miyu_biyou", "iroyuru_", "kui_nyan_", "miyu_bgnr",
        "hana_beatbabe", "rin_g_bx", "nemu_bloom", "hinata_w_cosme", "n7_cos",
        "c1115Sarah", "rutho0vazy0", "donna2010ir2lzv", "momoka_coswalk",
        "onaka_no_yuki", "ElizabethG76409", "barbara1fz0w3n", "carolr7ew8st",
        "mochiko_diett", "ricochan_diet", "idol_dol1920"
    ].map(u => u.toLowerCase());

    const matches: any[] = [];
    const containerIdMatches: any[] = [];

    for (const row of allAccounts) {
        const username = (row.x_username || "").toLowerCase();
        const cid = (row.container_id || "").toLowerCase();

        if (excludeUsernames.some(u => username.includes(u))) {
            matches.push(row);
        }
        if (excludeUsernames.some(u => cid.includes(u))) {
            containerIdMatches.push(row);
        }
    }

    console.log(`\n### Investigation Result ###`);
    console.log(`Username Partial Matches: ${matches.length}`);
    matches.forEach(m => console.log(`- @${m.x_username} (${m.container_id})`));

    console.log(`\nContainer ID Partial Matches: ${containerIdMatches.length}`);
    containerIdMatches.forEach(m => console.log(`- @${m.x_username} (${m.container_id})`));
}

main().catch(console.error);
