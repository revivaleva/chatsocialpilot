import Database from "better-sqlite3";
const db = new Database("storage/app.db");
const columns = db.prepare("PRAGMA table_info(tasks)").all();
console.log(JSON.stringify(columns, null, 2));
