
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    const missing = ["onaka_no_yuki", "mochiko_diett", "ricochan_diet", "idol_dol1920"];
    for (const name of missing) {
        // Search just for the name in any field
        const found = query("SELECT container_id, x_username FROM x_accounts WHERE x_username LIKE ? OR container_id LIKE ?", [`%${name}%`, `%${name}%`]);
        console.log(`Searching for: ${name}`);
        console.table(found);
    }

    // Check all x_usernames to see similar ones
    const allUsernames = query("SELECT x_username FROM x_accounts WHERE x_username IS NOT NULL", []);
    console.log("Total usernames found:", allUsernames.length);
}

main().catch(console.error);
