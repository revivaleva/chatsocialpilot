import { run as dbRun, query as dbQuery } from '../drivers/db';

const PATH_RE = /([A-Za-z]:\\[^*?"<>|]+)(?=\s|$)/;
const URL_RE  = /(https?:\/\/\S+)/i;

let _memEnsured = false;
function ensureMemTable() {
  if (_memEnsured) return;
  dbRun(`CREATE TABLE IF NOT EXISTS memory (
    key TEXT PRIMARY KEY,
    type TEXT,
    value_json TEXT,
    updated_at INTEGER
  )`);
  _memEnsured = true;
}

export function memSet(key: string, value: any, type: 'fact'|'pref'|'alias' = 'fact') {
  ensureMemTable();
  const now = Date.now();
  const v = JSON.stringify(value);
  return dbRun(`INSERT INTO memory(key,type,value_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET type=excluded.type, value_json=excluded.value_json, updated_at=excluded.updated_at`, [key, type, v, now]);
}

export function memGet(key: string) {
  ensureMemTable();
  const rows = dbQuery(`SELECT key,type,value_json,updated_at FROM memory WHERE key = ?`, [key]);
  if (!rows || rows.length === 0) return undefined;
  const r = rows[0];
  try { return JSON.parse(r.value_json); } catch { return r.value_json; }
}

export function memList(limit = 100) {
  ensureMemTable();
  const rows = dbQuery(`SELECT key,type,value_json,updated_at FROM memory ORDER BY updated_at DESC LIMIT ?`, [limit]);
  return rows.map((r:any) => {
    let v:any = r.value_json;
    try { v = JSON.parse(v); } catch {}
    return { key: r.key, type: r.type, value: v, updated_at: r.updated_at };
  });
}

export function memorySummary(maxItems = 10): string {
  // compatibility: if caller passed a large number (e.g., 800) treat as maxLen
  let maxLen = 800;
  if (typeof maxItems === 'number' && maxItems > 100) { maxLen = maxItems; maxItems = 10; }
  const rows = memList(maxItems * 3 || 30);
  const aliases = rows.filter(r => r.type === 'alias').map(r => r.key).slice(0, maxItems);
  const prefs = rows.filter(r => r.type === 'pref').slice(0, maxItems).map(r => {
    const v = r.value;
    if (typeof v === 'object' && v && v.name) return `${r.key}=${v.name}`;
    if (typeof v === 'string' || typeof v === 'number') return `${r.key}=${String(v)}`;
    return r.key;
  });
  const facts = rows.filter(r => r.type === 'fact').slice(0, maxItems).map(r => r.key);
  const parts: string[] = [];
  if (aliases.length) parts.push(`aliases: ${aliases.join(', ')}`);
  if (prefs.length) parts.push(`prefs: ${prefs.join(', ')}`);
  if (facts.length) parts.push(`facts: ${facts.join(', ')}`);
  const out = parts.join(' / ');
  return out.slice(0, maxLen);
}

export async function rememberFromUtterance(text: string): Promise<{ok:boolean; msg:string}> {
  // quick patterns
  // alias: @name は <path>
  const aliasMatch = text.match(/@([A-Za-z0-9_-]+)\s*(は|:)\s*([^\n]+)/);
  if (aliasMatch) {
    const name = aliasMatch[1];
    const val = aliasMatch[3].trim();
    memSet(`alias.profile.${name}`, { profilePath: val }, 'alias', 'global');
    return { ok:true, msg:`保存しました: alias.profile.${name}` };
  }
  // pref: max tokens は 2000
  const prefMatch = text.match(/max tokens は\s*(\d{2,4})/i) || text.match(/max tokens\s*:?\s*(\d{2,4})/i);
  if (prefMatch) {
    const n = Number(prefMatch[1]);
    memSet('pref.chat.max_tokens', n, 'pref', 'global');
    return { ok:true, msg:`既定 max tokens を ${n} に設定しました` };
  }

  // fallback to LLM extraction
  try {
    // ask LLM to return JSON items
    const sys = `Extract memory items as JSON: {"items":[{"k":"...","v":...,"type":"fact|pref|alias"}]}. If none, return {"items":[]} `;
    const out = await (await import('../drivers/openai')).chatText({ model: 'gpt-5-nano', system: sys, user: text, max_completion_tokens: 300 });
    try {
      const j = JSON.parse(out || '{}');
      if (j && Array.isArray(j.items)) {
        for (const it of j.items) {
          if (it.k) memSet(it.k, it.v, it.type || 'fact', 'global');
        }
        return { ok:true, msg:`保存しました: ${j.items.length} 件` };
      }
    } catch {}
  } catch {}
  return { ok:false, msg:'記憶できませんでした（パターン不一致）' };
}

// (memorySummary is implemented below with a richer behavior)

export async function maybeHandleMemory(text: string): Promise<{ok:boolean; msg:string} | null> {
  if (/覚え|記憶|保存|覚えて/i.test(text)) {
    return await rememberFromUtterance(text);
  }
  if (/忘れ|削除|クリア/i.test(text)) {
    return { ok:false, msg:'忘れる機能は未実装です' };
  }
  return null;
}

export function resolveProfileAlias(aliasOrPath: string): { profilePath: string } | null {
  if (!aliasOrPath) return null;
  if (/^[A-Za-z]:\\/.test(aliasOrPath)) return { profilePath: aliasOrPath };
  const name = aliasOrPath.replace(/^@/, '');
  const v = memGet(`alias.profile.${name}`);
  if (v && v.profilePath) return { profilePath: v.profilePath };
  return null;
}

export function getPreferredMaxTokens(defaultValue: number): number {
  const v = memGet('pref.chat.max_tokens');
  if (typeof v === 'number' && v > 0) return v;
  return defaultValue;
}


