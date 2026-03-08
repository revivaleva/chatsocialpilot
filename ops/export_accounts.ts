#!/usr/bin/env tsx
/**
 * 指定アカウント（x_username または container_id）のXアカウントをCSV形式で標準出力する。
 *
 * 形式: login_ID,Password,Mail,Mail_Pass,2FA,,AuthToken
 * login_ID は container_id を出力。リストは x_username / container_id のどちらでも照合する。
 *
 * 使用例:
 *   npm run export:tsv
 */

import { initDb, query } from '../src/drivers/db.js';

const TARGET_KEYS = [
  'rutho0vazy0',
  'helenf1sngq2',
  'sharon60qfb3v',
  'yuzu_hadalog',
  'momoka_coswalk',
  'minori_sinknote',
  'donna34iwh5m',
  'helenm3fs0ux',
  'linda13jmp3u',
  'sarahs4kh2kh',
  'carolr7ew8st',
  'ElizabethG76409',
  'caroly5tz4ei',
  'barbara1fz0w3n',
  'karenv1rmxg3',
  'maria43bvk7n',
  'sarahm2ni5gh',
  'ruth8vj3e3i',
  'betty0db4d1q',
  'patricia2wo2d5x',
];

interface XAccountRow {
  container_id: string;
  x_username: string | null;
  x_password: string | null;
  email: string | null;
  email_password: string | null;
  twofa_code: string | null;
  auth_token: string | null;
}

function csvEscape(val: string | null): string {
  const s = String(val ?? '');
  if (s === '') return '';
  if (/[,"\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function main(): void {
  initDb();

  if (TARGET_KEYS.length === 0) {
    console.error('TARGET_KEYS が空です。');
    process.exit(1);
  }

  const placeholders = TARGET_KEYS.map(() => '?').join(',');
  const rows = query<XAccountRow>(
    `SELECT container_id, x_username, x_password, email, email_password, twofa_code, auth_token
     FROM x_accounts WHERE x_username IN (${placeholders}) OR container_id IN (${placeholders})`,
    [...TARGET_KEYS, ...TARGET_KEYS]
  );

  const byKey = new Map<string, XAccountRow>();
  for (const r of rows) {
    byKey.set(r.container_id, r);
    if (r.x_username) byKey.set(r.x_username, r);
  }

  const header = 'login_ID,Password,Mail,Mail_Pass,2FA,,AuthToken';
  const lines: string[] = [header];

  for (const key of TARGET_KEYS) {
    const r = byKey.get(key);
    if (!r) continue;
    let mail = csvEscape(r.email);
    let mailPass = '';
    if (r.email_password) {
      const idx = r.email_password.indexOf(':');
      if (idx >= 0) {
        if (!mail) mail = csvEscape(r.email_password.slice(0, idx));
        mailPass = csvEscape(r.email_password.slice(idx + 1));
      }
    }

    const row = [
      csvEscape(r.container_id),
      csvEscape(r.x_password),
      mail,
      mailPass,
      csvEscape(r.twofa_code),
      '',
      csvEscape(r.auth_token),
    ].join(',');
    lines.push(row);
  }

  console.log(lines.join('\n'));
}

main();
