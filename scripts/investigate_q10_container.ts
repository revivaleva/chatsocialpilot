
import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    const targetContainer = '4931a230-c970-4a8b-9d1b-7888152f40cf';
    console.log(`Checking profile for container found in queue10: ${targetContainer}`);

    const profile = query(`SELECT * FROM profiles WHERE id = ? OR path LIKE ?`, [targetContainer, `%${targetContainer}%`])[0] as any;
    console.log('Profile:', JSON.stringify(profile));

    const xAccount = query(`SELECT * FROM x_accounts WHERE container_id = ?`, [targetContainer])[0] as any;
    console.log('X Account:', JSON.stringify(xAccount));
}

main().catch(console.error);
