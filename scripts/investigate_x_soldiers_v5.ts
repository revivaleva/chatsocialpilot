
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // 1. Get ALL accounts from x_accounts
    const allAccounts = query(`
        SELECT container_id, x_username
        FROM x_accounts
    `, []) as any[];

    // Exact list of usernames to exclude
    const excludeUsernames = [
        "an_cosme_beauty", "miyu_biyou", "iroyuru_", "kui_nyan_", "miyu_bgnr",
        "hana_beatbabe", "rin_g_bx", "nemu_bloom", "hinata_w_cosme", "n7_cos",
        "c1115Sarah", "rutho0vazy0", "donna2010ir2lzv", "momoka_coswalk",
        "onaka_no_yuki", "ElizabethG76409", "barbara1fz0w3n", "carolr7ew8st",
        "mochiko_diett", "ricochan_diet", "idol_dol1920"
    ].map(u => u.toLowerCase());

    const exactMatches: any[] = [];

    for (const row of allAccounts) {
        let username = (row.x_username || "").toLowerCase();
        // Remove @ if present
        if (username.startsWith("@")) {
            username = username.substring(1);
        }

        if (excludeUsernames.includes(username)) {
            exactMatches.push(row);
        }
    }

    console.log(`\n### Exact Match Result (Handle @ and case) ###`);
    console.log(`Matches Found: ${exactMatches.length}`);

    if (exactMatches.length > 0) {
        exactMatches.forEach(a => console.log(`- @${a.x_username} (Container: ${a.container_id})`));
    } else {
        console.log("Still 0 exact matches found. Searching for 'an_cosme_beauty' specifically...");
        const specific = query(`SELECT * FROM x_accounts WHERE x_username LIKE '%an_cosme%'`, []);
        console.log("LIKE '%an_cosme%':", specific);
    }
}

main().catch(console.error);
