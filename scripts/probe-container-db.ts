import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

function appData(): string {
  return process.env.APPDATA || path.join(process.env.HOME || "", "AppData", "Roaming");
}
function defaultDb(): string {
  return path.join(appData(), "container-browser", "data.db");
}
function dirFromPartition(partition: string): string {
  const base = (partition || "").replace(/^persist:/, "");
  return path.join(appData(), "container-browser", "Partitions", base);
}

try {
  const dbPath = process.env.CONTAINER_DB || defaultDb();
  if (!fs.existsSync(dbPath)) {
    console.error("DB not found:", dbPath);
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT id,name,userDataDir,partition,createdAt,updatedAt
    FROM containers ORDER BY updatedAt DESC
  `).all();

  const items = rows.map((r: any) => ({
    id: r.id,
    name: r.name || r.id,
    dir: (r.userDataDir && String(r.userDataDir).trim()) ? r.userDataDir : dirFromPartition(r.partition),
    partition: r.partition,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  console.log(JSON.stringify({ dbPath, count: items.length, items }, null, 2));
} catch (e: any) {
  console.error("probe-container-db error:", e?.message || String(e));
  process.exit(1);
}


