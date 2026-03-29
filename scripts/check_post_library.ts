
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();
    const result = query(`SELECT count(*) as count FROM post_library WHERE used = 0`, []) as any[];
    console.log(`Unused posts in post_library: ${result[0].count}`);
}

main().catch(console.error);
