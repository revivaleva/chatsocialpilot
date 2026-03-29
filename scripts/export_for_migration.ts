import { initDb, query, run, transaction } from '../src/drivers/db.js';
import fs from 'fs';
import path from 'path';

async function main() {
    initDb();
    const exportDir = 'migration_export';
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir);

    console.log('Exporting presets...');
    const presets = query("SELECT * FROM presets");
    fs.writeFileSync(path.join(exportDir, 'presets.json'), JSON.stringify(presets, null, 2));
    console.log(`Exported ${presets.length} presets.`);

    console.log('Exporting 1000 unused emails...');
    const emailsToExport = query("SELECT * FROM email_accounts WHERE used_at IS NULL LIMIT 1000");
    if (emailsToExport.length < 1000) {
        console.warn(`Only found ${emailsToExport.length} unused emails. Exporting all of them.`);
    }
    fs.writeFileSync(path.join(exportDir, 'emails.json'), JSON.stringify(emailsToExport, null, 2));
    console.log(`Exported ${emailsToExport.length} emails.`);

    console.log('Marking exported emails as used in local DB...');
    const now = Date.now();
    const ids = emailsToExport.map(e => e.id);

    if (ids.length > 0) {
        transaction(() => {
            const placeholders = ids.map(() => '?').join(',');
            run(`UPDATE email_accounts SET used_at = ? WHERE id IN (${placeholders})`, [now, ...ids]);
        });
        console.log(`Marked ${ids.length} emails as used.`);
    }

    console.log('Export complete. Files are in migration_export/');
}

main().catch(console.error);
