import Database from "better-sqlite3";
const db = new Database("storage/app.db");

const profiles = db.prepare("SELECT * FROM profiles LIMIT 5").all();
console.log("Profiles sample:", profiles);

const x_acc = db.prepare("SELECT container_id FROM x_accounts LIMIT 5").all();
console.log("x_acc sample:", x_acc);

const cgm = db
  .prepare("SELECT container_id FROM container_group_members LIMIT 5")
  .all();
console.log("cgm sample:", cgm);
