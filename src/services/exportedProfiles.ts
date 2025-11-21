import fetch from 'node-fetch';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_PORT = Number(process.env.CONTAINER_EXPORT_PORT || 3001);
const HOST = process.env.CONTAINER_EXPORT_HOST || '127.0.0.1';

function baseUrl() {
  return `http://${HOST}:${DEFAULT_PORT}`;
}

export async function exportRestored(containerId: string, forceCopy = false, ensureAuth = true) {
  const url = `${baseUrl()}/internal/export-restored`;
  const body = { id: containerId, forceCopy, ensureAuth };
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await resp.json().catch(()=>({ ok:false, error: 'invalid-json' }));
  if (!resp.ok || j?.ok !== true) throw new Error(j?.error || `export failed (${resp.status})`);
  return { path: j.path, lastSessionId: j.lastSessionId || null, token: j.token || null };
}

export async function deleteExported(exportPath: string) {
  const url = `${baseUrl()}/internal/export-restored/delete`;
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: exportPath }) });
  const j = await resp.json().catch(()=>({ ok:false, error: 'invalid-json' }));
  if (!resp.ok || j?.ok !== true) throw new Error(j?.error || `delete failed (${resp.status})`);
  return { ok:true };
}


