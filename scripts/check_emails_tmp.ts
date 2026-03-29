
import { initDb, query } from '../src/drivers/db';

async function getEmailInfo() {
    initDb();
    const ids = [
        "c3146510-1b4e-48dc-905f-377882dda1c7",
        "e9312942-0721-4dcb-8359-a103999a3924",
        "23e9a23c-51a4-473c-b060-b90825298939",
        "34dabbdf-6a8b-4e90-a530-af5f1d6a7fd2",
        "08b9ebbe-6660-40ca-a9a6-02c8b03bb63a",
        "c575537f-a8dd-41f1-8434-da139162dd3c"
    ];

    for (const id of ids) {
        const accs = query('SELECT * FROM x_accounts WHERE container_id = ?', [id]);
        if (accs.length > 0) {
            const acc = accs[0];
            console.log(`Account: ${id} | Email: ${acc.email} | Pass: ${acc.email_password}`);
        } else {
            // Try searching by exact screen name?
            // Actually, "container_id" in DB is usually the XID or a unique string.
            // If the user says "AlbertEbne87131", then that's the container_id.
            // But my "ids" here are from activeIds of CB, which are UUIDs.
            // Let's check the database contents!
            const all = query('SELECT container_id, email FROM x_accounts LIMIT 5');
            console.log("DB Sample:", all);
            break;
        }
    }
}
getEmailInfo();
