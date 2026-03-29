import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();
    const groups = query("SELECT id, name FROM container_groups", []);
    console.log(JSON.stringify(groups, null, 2));
}

main().catch(console.error);
