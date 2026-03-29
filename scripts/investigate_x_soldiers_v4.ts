
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    // 1. Get ALL accounts from x_accounts
    const allAccounts = query(`
        SELECT container_id, x_username
        FROM x_accounts
    `, []) as any[];

    // List of snippets from exclusion list to search within usernames
    const excludeSnippets = [
        "cosme", "beauty", "biyou", "bgnr", "iroyuru", "hana", "nemu", "hinata", "sarah", "rutho", "donna", "momoka", "yuki", "elizabeth", "barbara", "carol", "mochiko", "rico", "idol"
    ].map(s => s.toLowerCase());

    const fuzzyMatches: any[] = [];

    for (const row of allAccounts) {
        const username = (row.x_username || "").toLowerCase();
        if (excludeSnippets.some(snippet => username.includes(snippet))) {
            fuzzyMatches.push(row);
        }
    }

    console.log(`\n### Fuzzy (Snippet) Match Result ###`);
    console.log(`Matches Found: ${fuzzyMatches.length}`);

    if (fuzzyMatches.length > 0) {
        fuzzyMatches.forEach(a => console.log(`- @${a.x_username} (Container: ${a.container_id})`));
    }
}

main().catch(console.error);
