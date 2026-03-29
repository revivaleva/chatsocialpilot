
import { initDb, query } from '../src/drivers/db.js';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
    initDb();

    // Find "X兵隊" group ID
    const groupResult = query("SELECT id FROM container_groups WHERE name = 'X兵隊'", []);
    if (groupResult.length === 0) {
        console.error('Group "X兵隊" not found');
        return;
    }
    const groupId = groupResult[0].id;

    // Fetch account details for members of this group
    const accounts = query(`
        SELECT 
            x.container_id, 
            x.x_password, 
            x.email, 
            x.email_password, 
            p.proxy_info, 
            x.twofa_code, 
            x.auth_token, 
            x.ct0
        FROM container_group_members m
        JOIN x_accounts x ON m.container_id = x.container_id
        LEFT JOIN proxies p ON x.proxy_id = p.id
        WHERE m.group_id = ?
    `, [groupId]);

    if (accounts.length === 0) {
        console.log('No accounts found for group "X兵隊"');
        return;
    }

    // CSV Header
    const header = 'XID,x_password,email,メールパスワード,プロキシ情報,2FAコード,auth_token,ct0';

    // Convert to CSV lines
    const csvLines = accounts.map(a => {
        // email_password format is "email:password", we want just the password part.
        let cleanEmailPass = a.email_password || '';
        if (a.email && cleanEmailPass.startsWith(a.email + ':')) {
            cleanEmailPass = cleanEmailPass.substring(a.email.length + 1);
        } else if (cleanEmailPass.includes(':')) {
            // Fallback if it doesn't match perfectly
            const firstColon = cleanEmailPass.indexOf(':');
            cleanEmailPass = cleanEmailPass.substring(firstColon + 1);
        }

        return [
            a.container_id || '',
            a.x_password || '',
            a.email || '',
            cleanEmailPass,
            a.proxy_info || '',
            a.twofa_code || '',
            a.auth_token || '',
            a.ct0 || ''
        ].map(v => {
            // Escape double quotes and wrap in quotes if necessary
            const str = String(v).replace(/"/g, '""');
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str}"`;
            }
            return str;
        }).join(',');
    });

    const csvContent = [header, ...csvLines].join('\n');
    const outputPath = path.resolve('heitai_accounts_list.csv');
    fs.writeFileSync(outputPath, csvContent, 'utf8');

    console.log(`Successfully exported ${accounts.length} accounts to ${outputPath}`);
}

main().catch(console.error);
