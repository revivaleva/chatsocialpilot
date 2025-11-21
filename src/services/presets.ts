import { query, run } from '../drivers/db';
import { logger } from '../utils/logger';

export function listPresets() {
  return query('SELECT id,name,description,steps_json,created_at,updated_at FROM presets ORDER BY id DESC');
}

export function getPreset(id: number) {
  const rows = query('SELECT id,name,description,steps_json,created_at,updated_at FROM presets WHERE id=?', [id]);
  return rows && rows.length ? rows[0] : null;
}

export function createPreset(name: string, description: string, stepsJson: string) {
  const now = Date.now();
  const res = run('INSERT INTO presets(name,description,steps_json,created_at,updated_at) VALUES(?,?,?,?,?)', [name, description, stepsJson, now, now]);
  logger.info('preset created', { id: res.lastInsertRowid, name });
  return { id: res.lastInsertRowid };
}

export function updatePreset(id: number, name: string, description: string, stepsJson: string) {
  const now = Date.now();
  run('UPDATE presets SET name=?, description=?, steps_json=?, updated_at=? WHERE id=?', [name, description, stepsJson, now, id]);
  return { ok: true };
}

export function deletePreset(id: number) {
  run('DELETE FROM presets WHERE id=?', [id]);
  return { ok: true };
}

export function recordJobRun(jobId: number|null, presetId: number, stepIndex: number, stepJson: string, okFlag: boolean, resultJson: any, errorText: string|null, elapsedMs: number) {
  const now = Date.now();
  run('INSERT INTO job_runs(job_id,preset_id,step_index,step_json,ok,result_json,error_text,elapsed_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?)', [jobId, presetId, stepIndex, stepJson, okFlag ? 1 : 0, JSON.stringify(resultJson || {}), errorText, elapsedMs, now]);
}


