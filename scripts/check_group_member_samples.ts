
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Sample check for 'X兵隊' group members ###");
    const m = query("SELECT container_id FROM container_group_members WHERE group_id = '6df1aacd-4623-4908-9e2d-9fa1d9990109' LIMIT 5");
    console.table(m);
}

main().catch(console.error);
