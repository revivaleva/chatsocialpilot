import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();
    const exactBanned = query("SELECT * FROM container_groups WHERE name = 'Banned'", []);
    console.log("Exact 'Banned' match:", exactBanned);

    const caseInsensitiveBanned = query("SELECT * FROM container_groups WHERE name LIKE 'Banned'", []);
    console.log("Case-insensitive 'Banned' match:", caseInsensitiveBanned);

    const partialBanned = query("SELECT * FROM container_groups WHERE name LIKE '%Banned%'", []);
    console.log("Partial 'Banned' match:", partialBanned);
}

main().catch(console.error);
