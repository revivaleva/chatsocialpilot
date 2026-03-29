import Database from "better-sqlite3";
const db = new Database("storage/app.db");
const presets = db
  .prepare(
    "SELECT id, name FROM presets WHERE name LIKE '%ログイン%' OR name LIKE '%Login%'",
  )
  .all();
console.log(JSON.stringify(presets, null, 2));
