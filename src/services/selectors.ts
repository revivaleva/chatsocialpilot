import { query, run } from '../drivers/db';

export type LocatorCandidate = { strategy: 'getByRole'|'getByLabel'|'getByText'|'css', locator: string };

function uniq<T>(arr: T[], key: (x:T)=>string): T[] {
  const seen = new Set<string>(); const out: T[] = [];
  for (const x of arr) { const k = key(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

export function getCandidates(siteHash: string, keyName: string, limit = 20): LocatorCandidate[] {
  const rows = query<any>(
    'SELECT locator_json, success_rate, updated_at FROM selectors WHERE site_hash = ? AND key = ? ORDER BY success_rate DESC, updated_at DESC LIMIT 50',
    [siteHash, keyName]
  );
  const flat: LocatorCandidate[] = [];
  for (const r of rows) {
    try {
      const arr = JSON.parse(r.locator_json || '[]') as LocatorCandidate[];
      for (const c of arr) if (c?.strategy && c?.locator) flat.push(c);
    } catch {}
  }
  return uniq(flat, c => `${c.strategy}|${c.locator}`).slice(0, limit);
}

export function recordSuccess(siteHash: string, keyName: string, winner: LocatorCandidate) {
  const now = new Date().toISOString();
  const locJson = JSON.stringify([winner]);
  run('INSERT INTO selectors(site_hash, key, locator_json, success_rate, updated_at) VALUES (?, ?, ?, ?, ?)',
    [siteHash, keyName, locJson, 1.0, now]);
}

export function recordFailure(siteHash: string, keyName: string, tried?: LocatorCandidate) {
  const now = new Date().toISOString();
  const locJson = JSON.stringify(tried ? [tried] : []);
  run('INSERT INTO selectors(site_hash, key, locator_json, success_rate, updated_at) VALUES (?, ?, ?, ?, ?)',
    [siteHash, keyName, locJson, tried ? 0.1 : 0, now]);
}





