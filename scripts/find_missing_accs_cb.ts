
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";

function defaultContainerDb() {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return process.env.DEFAULT_CB_DB || path.join(appData, "container-browser", "data.db");
}

async function main() {
    const missing = ["onaka_no_yuki", "mochiko_diett", "ricochan_diet", "idol_dol1920"];
    const dbPath = defaultContainerDb();
    if (fs.existsSync(dbPath)) {
        const containerDb = new Database(dbPath, { readonly: true });
        for (const name of missing) {
            const found = containerDb.prepare("SELECT id, name FROM containers WHERE name LIKE ?").all(`%${name}%`);
            console.log(`Results for ${name} in container-browser:`);
            console.table(found);
        }
        containerDb.close();
    }
}

main().catch(console.error);
