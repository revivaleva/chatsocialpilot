
import { initDb, query } from '../src/drivers/db.js';

async function main() {
  initDb();
  const tables = query("SELECT name FROM sqlite_master WHERE type='table'");
  console.log(JSON.stringify(tables, null, 2));
}

main().catch(console.error);
