
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('Checking profiles for ID or Alias 10...');
    const profileById = query(`SELECT * FROM profiles WHERE id = 10`)[0] as any;
    if (profileById) {
        console.log(`Profile ID 10 Match: ${JSON.stringify(profileById)}`);
    }

    const profileByAlias = query(`SELECT * FROM profiles WHERE alias = '10'`)[0] as any;
    if (profileByAlias) {
        console.log(`Profile Alias '10' Match: ${JSON.stringify(profileByAlias)}`);
    }

    console.log('\nChecking container_groups for name or ID 10...');
    const groups = query(`SELECT * FROM container_groups WHERE id = '10' OR name LIKE '%10%'`);
    console.table(groups);

    console.log('\nChecking tasks for any reference to 10 in status or queue...');
    const tasks = query(`SELECT * FROM tasks WHERE queue_name LIKE '%10%' OR status LIKE '%10%' LIMIT 5`);
    console.table(tasks);
}

main().catch(console.error);
