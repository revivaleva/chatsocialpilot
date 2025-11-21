import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

type Account = { name: string; profileUserDataDir: string };

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

function accountsPath(): string {
  return path.join(process.cwd(), "config", "accounts.json");
}
function readAccounts(): Account[] {
  const p = accountsPath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}
function writeAccounts(data: Account[]) {
  const p = accountsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

try {
  const dbPath = process.env.CONTAINER_DB || defaultDb();
  if (!fs.existsSync(dbPath)) {
    console.error("DB not found:", dbPath);
    process.exit(1);
  }
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT id,name,userDataDir,partition
    FROM containers
  `).all();

  const existing = readAccounts();
  const byName = new Map(existing.map(a => [a.name, a]));

  let added = 0, skipped = 0;
  for (const r of rows) {
    const name: string = r.name || r.id;
    const dir: string =
      (r.userDataDir && String(r.userDataDir).trim())
        ? r.userDataDir
        : dirFromPartition(r.partition);

    if (byName.has(name)) { skipped++; continue; }
    const acc: Account = { name, profileUserDataDir: dir };
    existing.push(acc);
    byName.set(name, acc);
    added++;
  }

  writeAccounts(existing);
  console.log(JSON.stringify({
    dbPath, added, skipped, total: existing.length
  }, null, 2));
} catch (e: any) {
  console.error("import-container-db error:", e?.message || String(e));
  process.exit(1);
}


