
import { initDb, query } from "../src/drivers/db";

async function main() {
    initDb();

    console.log("### Target Exclude IDs ###");
    const excludeList = [
        "an_cosme_beauty", "miyu_biyou", "iroyuru_", "kui_nyan_", "miyu_bgnr",
        "hana_beatbabe", "rin_g_bx", "nemu_bloom", "hinata_w_cosme", "n7_cos",
        "c1115Sarah", "rutho0vazy0", "donna2010ir2lzv", "momoka_coswalk",
        "onaka_no_yuki", "ElizabethG76409", "barbara1fz0w3n", "carolr7ew8st",
        "mochiko_diett", "ricochan_diet", "idol_dol1920"
    ];

    for (const id of excludeList) {
        const row = query("SELECT * FROM x_accounts WHERE container_id = ?", [id]) as any[];
        if (row.length > 0) {
            const membership = query(`
                SELECT cg.name 
                FROM container_group_members cgm
                JOIN container_groups cg ON cgm.group_id = cg.id
                WHERE cgm.container_id = ?
            `, [id]) as any[];
            console.log(`ID: ${id} | Username: ${row[0].x_username} | Groups: ${membership.map(m => m.name).join(", ") || "No Group"}`);
        } else {
            // Check container-browser DB for these IDs?
            console.log(`ID: ${id} | Not found in x_accounts`);
        }
    }

    console.log("\n### Searching for members in Banned group ###");
    const bannedMembers = query(`
        SELECT count(*) as count 
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.name = 'Banned'
    `, []) as any[];
    console.log(`Total members in 'Banned' group: ${bannedMembers[0].count}`);

    const bannedSamples = query(`
        SELECT cgm.container_id, cg.name as group_name
        FROM container_group_members cgm
        JOIN container_groups cg ON cgm.group_id = cg.id
        WHERE cg.name = 'Banned'
        LIMIT 10
    `, []) as any[];
    console.table(bannedSamples);
}

main().catch(console.error);
