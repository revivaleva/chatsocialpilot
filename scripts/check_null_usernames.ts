
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Accounts with null x_username ###");
    const found = query("SELECT container_id, x_password, email FROM x_accounts WHERE x_username IS NULL LIMIT 100", []);
    console.table(found);
}

main().catch(console.error);
