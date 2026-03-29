
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    const missing = ["onaka_no_yuki", "mochiko_diett", "ricochan_diet", "idol_dol1920"];
    for (const name of missing) {
        const found = query("SELECT container_id, x_username FROM x_accounts WHERE x_username LIKE ? OR container_id LIKE ?", [`%${name}%`, `%${name}%`]);
        console.log(`Results for ${name}:`);
        console.table(found);
    }
}

main().catch(console.error);
