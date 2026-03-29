import { initDb, query } from '../src/drivers/db.js';

async function main() {
    initDb();

    console.log('--- email_accounts table ---');
    const emailAccountsCount = query("SELECT COUNT(*) as count FROM email_accounts WHERE used_at IS NULL")[0].count;
    console.log(`Unused email_accounts: ${emailAccountsCount}`);

    console.log('\n--- rolex_emails table ---');
    const rolexEmailsCount = query("SELECT COUNT(*) as count FROM rolex_emails WHERE used_count = 0")[0].count;
    console.log(`Unused rolex_emails: ${rolexEmailsCount}`);

    console.log('\n--- x_accounts table (email) ---');
    // Assuming x_accounts might have unused ones? Usually these are already assigned to containers.
    const xAccountsCount = query("SELECT COUNT(*) as count FROM x_accounts WHERE email IS NOT NULL")[0].count;
    console.log(`Total x_accounts with email: ${xAccountsCount}`);
}

main().catch(console.error);
