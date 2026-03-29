
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    const partials = ["onaka", "yuki", "mochi", "rico", "idol"];
    for (const p of partials) {
        const found = query("SELECT x_username, container_id FROM x_accounts WHERE x_username LIKE ? OR container_id LIKE ?", [`%${p}%`, `%${p}%`]);
        console.log(`Results for ${p}:`);
        console.table(found);
    }
}

main().catch(console.error);
