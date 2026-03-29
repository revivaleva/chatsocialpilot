import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const mysqlConfig = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'kameleo',
};

async function main() {
    const connection = await mysql.createConnection(mysqlConfig);
    try {
        console.log('Adding auth_token and ct0 columns to MySQL accounts table...');

        // 既に存在するか確認
        const [cols]: any = await connection.execute('SHOW COLUMNS FROM accounts');
        const colNames = cols.map((c: any) => c.Field);

        if (!colNames.includes('auth_token')) {
            await connection.execute('ALTER TABLE accounts ADD COLUMN auth_token TEXT');
            console.log('Added auth_token column.');
        } else {
            console.log('auth_token column already exists.');
        }

        if (!colNames.includes('ct0')) {
            await connection.execute('ALTER TABLE accounts ADD COLUMN ct0 TEXT');
            console.log('Added ct0 column.');
        } else {
            console.log('ct0 column already exists.');
        }

    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await connection.end();
    }
}

main();
