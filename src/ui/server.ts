import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';
import { initDb, query as dbQuery, memGet, memSet, run as dbRun } from '../drivers/db';
import { chatText, chatJson } from '../drivers/openai';
import { logger } from '../utils/logger';
import { memorySummary, maybeHandleMemory, resolveProfileAlias, getPreferredMaxTokens } from '../agent/memory';
import { parseIntent } from '../agent/intents';
import { closeContextById, openWithProfile, setCookiesInContext } from '../drivers/browser';
import crypto from 'node:crypto';
import keytar from 'keytar';
import { exportRestored, deleteExported } from '../services/exportedProfiles';
import * as PresetService from '../services/presets';
import child_process from 'node:child_process';
import { enqueueTask, setExecutionEnabled, isExecutionEnabled, parsePresetStepsJson, resolveStepTimeoutMs } from '../services/taskQueue';
import { appendJsonl } from '../utils/logger';
import { loadSettings, saveSettings, type AppSettings } from '../services/appSettings';

const spawnedMap = new Map<number, child_process.ChildProcess>();
// local accounts management and container-db helpers
const ACC_PATH = path.join(process.cwd(), 'config', 'accounts.json');
function readAccounts(): Array<{name:string; profileUserDataDir:string}> { try { return JSON.parse(fs.readFileSync(ACC_PATH,'utf8')); } catch { return []; } }
function writeAccounts(items: any[]) { fs.mkdirSync(path.dirname(ACC_PATH), { recursive: true }); fs.writeFileSync(ACC_PATH, JSON.stringify(items, null, 2), 'utf8'); }
function appData(): string { return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'); }
function dirFromPartition(partition: string): string { const base = String(partition || '').replace(/^persist:/, ''); return path.join(appData(), 'container-browser', 'Partitions', base); }
import { listEnabled } from '../services/capabilities';
import { router } from '../agent/planner';
import { dispatch } from '../agent/executor';
import { createTask, runTask, getTask } from '../agent/tasks';
import { scanContainers, findCompanionDbs, inspectDbSchema, importAccounts } from '../services/profiles';

const app = express();
let currentSettings = loadSettings();
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT || currentSettings.dashboardPort || 5173);

function getContainerExportConfig() {
  const host = process.env.CONTAINER_EXPORT_HOST || currentSettings.containerBrowserHost || '127.0.0.1';
  const port = Number(process.env.CONTAINER_EXPORT_PORT || currentSettings.containerBrowserPort || 3001);
  return { host, port };
}

function persistSettings(partial: Partial<AppSettings>) {
  currentSettings = saveSettings(partial);
  return currentSettings;
}

initDb({ wal: true });

// Helper to generate a unique message id for assistant responses
function genMessageId(requestId: string) {
  return `${requestId}-assistant-${Date.now()}-${Math.floor(Math.random()*9000)+1000}`;
}

app.use(express.json({ limit: '1mb' }));

// Ensure basic capabilities memory includes create_preset (so /api/chat can show it)
try {
  const caps = memGet('capabilities');
  if (!caps) {
    memSet('capabilities', [{ key: 'create_preset', title: 'プリセット作成', description: '空のプリセットを作成できます' }], 'fact');
    logger.info('seeded capabilities: create_preset');
  }
} catch (e) { logger.warn('seed capabilities failed', String(e)); }

// HTTP 計測ミドルウェア (軽量)
app.use((req: Request, res: Response, next: NextFunction) => {
  const t0 = Date.now();
  const { method, url } = req;
  const bodyPreview = (() => {
    try {
      const s = JSON.stringify(req.body ?? {});
      return s.length > 500 ? s.slice(0, 500) + '...(truncated)' : s;
    } catch { return ''; }
  })();
  const pathOnly = String(url || '').split('?')[0];
  const skipPaths = ['/api/tasks', '/api/health', '/api/task_runs', '/api/containers'];
  if (skipPaths.some(p => pathOnly.startsWith(p))) {
    return next();
  }
  logger.event('http.req', { method, url, bodyPreview }, 'info');
  res.on('finish', () => {
    const ms = Date.now() - t0;
    const status = res.statusCode;
    logger.event('http.res', { method, url, status, ms, contentLength: res.getHeader('Content-Length') }, status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info');
  });
  next();
});

// Utility for container-browser default path (env override)
function defaultCbDir(): string {
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appdata, 'container-browser');
}
function defaultContainerDb(): string {
  return process.env.DEFAULT_CB_DB || path.join(defaultCbDir(), 'data.db');
}

function probeContainersFromDb(dbPath: string) {
  if (!fs.existsSync(dbPath)) throw new Error(`db not found: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare(`
    SELECT id,name,userDataDir,partition,updatedAt
    FROM containers ORDER BY updatedAt DESC
  `).all();
  return rows.map((r: any) => ({ id: r.id, name: r.name || r.id, dir: (r.userDataDir && String(r.userDataDir).trim()) ? r.userDataDir : dirFromPartition(r.partition), partition: r.partition, updatedAt: r.updatedAt }));
}

// モデル一覧（簡易）
app.get('/api/models', (_req, res) => {
  res.json(['gpt-5-nano', 'gpt-5-mini', 'gpt-4o-mini']);
});

// チャットAPI
app.post('/api/chat', async (req, res) => {
  const t0 = Date.now();
  const requestId = `${Date.now()}-${Math.floor(Math.random()*100000)}`;
  try {
    const REQ_TIMEOUT = Number(process.env.CHAT_ROUTE_TIMEOUT_MS || 120000);
    res.setTimeout(REQ_TIMEOUT);
    const { model, system, user, max_completion_tokens, temperature, contextId } = req.body || {};
    const clientSessionId = (req.body && req.body.sessionId) ? String(req.body.sessionId) : '';
    const sessionId = clientSessionId || requestId;
    logger.event('ai.chat.req', { model: model || process.env.NLU_MODEL, contextId: contextId || null, userLen: typeof user === 'string' ? user.length : JSON.stringify(user).length }, 'info');
    const ctxIdFromReq = contextId;
    if (!user || (typeof user !== 'string' && typeof user !== 'object')) {
      logger.event('api.chat.badrequest', { request_id: requestId, reason: 'invalid user' }, 'warn');
      return res.status(400).json({ error: 'user is required (string or object)' });
    }
    const mdl = model || process.env.NLU_MODEL || 'gpt-5-nano';
    // normalized planCandidates array (will be filled after calling router)
    let planCandidatesArr: any[] = [];
    // save user message to chat_messages
    try {
      const userMessageId = genMessageId(requestId);
      dbRun('INSERT INTO chat_messages(session_id,message_id,role,text,meta_json,created_at) VALUES(?,?,?,?,?,?)', [sessionId, userMessageId, 'user', typeof user === 'string' ? user : JSON.stringify(user), JSON.stringify(null), Date.now()]);
    } catch (e:any) { /* ignore chat history save errors */ }
    // Decide whether to send temperature based on model characteristics.
    // We support two modes:
    // - FAST HEURISTIC (default): disable for models containing 'nano' or listed in DISABLE_TEMPERATURE_MODELS
    // - AI CHECK (opt-in): if ENABLE_AI_MODEL_CHECK=1, ask an assistant model to judge and cache the result
    async function decideTemperatureToSend(modelName: string, t: any) {
      if (typeof t !== 'number') return undefined;
      const m = (modelName || '').toLowerCase();
      const disabled = (process.env.DISABLE_TEMPERATURE_MODELS || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
      if (disabled.includes(m)) return undefined;
      if (m.includes('nano')) return undefined;

      // optional AI check
      if (process.env.ENABLE_AI_MODEL_CHECK === '1') {
        try {
          // simple cache on process
          (decideTemperatureToSend as any)._cache = (decideTemperatureToSend as any)._cache || {};
          const c = (decideTemperatureToSend as any)._cache;
          if (typeof c[m] !== 'undefined') return c[m] ? t : undefined;
          // ask a helper model (use gpt-5-mini if available)
          // choose a helper model that supports temperature, avoid using nano models for this helper
          const envModel = (process.env.NLU_MODEL || '').toLowerCase();
          const helperModel = envModel && !envModel.includes('nano') ? envModel : 'gpt-5-mini';
          const sys = `あなたはモデル互換性判定エージェントです。与えられたモデル名に対して、温度パラメータ（temperature）が1以外の値をサポートするかどうかをJSONで返してください。例えば {"allowTemperature": true} または {"allowTemperature": false} のみを返してください。モデル名: "${modelName}"`;
          // Do not send temperature to the helper to avoid unsupported-parameter errors; helper should decide based on model name
          const res = await chatJson<{ allowTemperature: boolean }>({ model: helperModel, system: sys, user: '', responseJson: true, max_completion_tokens: 200 });
          const ok = !!(res && (res as any).allowTemperature);
          c[m] = ok;
          return ok ? t : undefined;
        } catch (e) {
          // fallback to heuristic
          return t;
        }
      }

      return t;
    }

    // NLU: check intent and generate planCandidates (do not auto-dispatch unless high confidence)
    let parsed = null;
    let planCandidates = null;
    try {
      const utter = typeof user === 'string' ? user : JSON.stringify(user);
      parsed = await parseIntent(utter);
      try {
        const memCaps = memGet('capabilities') || null;
        const context = { sessionId: requestId, memory: memCaps };
        planCandidates = await router(utter, context);
      } catch (planErr) {
        logger.event('api.chat.plan.err', { request_id: requestId, err: String(planErr) }, 'warn');
        planCandidates = null;
      }
      // normalize planCandidates for downstream (server returns array to UI)
      planCandidatesArr = planCandidates ? (Array.isArray(planCandidates) ? planCandidates as any[] : [planCandidates]) : [];
      // If parsed intent is actionable, decide whether to auto-dispatch.
      // Heuristic: if confidence >= HIGH_CONF or user used explicit imperative phrases, allow dispatch.
      const HIGH_CONF = Number(process.env.AUTO_EXEC_CONF_HIGH || 0.9);
      // Use planner.router output (planCandidates) to decide auto-execution instead of regex heuristics.
      // planCandidates is expected to be an object returned from planner.router with fields:
      // { decision, capability, arguments, ask_message, reason, confidence? }
      try {
        const routerOut = planCandidates || null;
        const capabilityKey = routerOut && (routerOut.capability || routerOut.capability_key || null);
        const capabilityArgs = routerOut && (routerOut.arguments || {});
        const routerDecision = routerOut && (routerOut.decision || '');
        const routerConfidence = Number(routerOut && (routerOut.confidence || 0)) || 0;

        const parsedConfidence = parsed && typeof parsed.confidence === 'number' ? parsed.confidence : 0;
        const effectiveConfidence = Math.max(parsedConfidence, routerConfidence);

        // Prepare args early so we can handle explicit "タスク作成" requests even if router didn't auto-execute.
        const args = Object.assign({}, parsed && parsed.args ? parsed.args : {}, capabilityArgs || {});
        if (ctxIdFromReq && !args.contextId) args.contextId = ctxIdFromReq;

        // If the user explicitly asked to create/register a task (Japanese "タスク"), attempt to enqueue for presets.
        const utterLower = String(utter || '').toLowerCase();
        if (/タスク/.test(utterLower) || /タスク作成/.test(utterLower) || /タスクを作成/.test(utterLower) || /タスク登録/.test(utterLower)) {
          try {
            if (capabilityKey && String(capabilityKey).startsWith('preset:')) {
              const pid = Number(String(capabilityKey).split(':')[1]);
              if (!pid) throw new Error('invalid preset id in capability');
              if (!args.containerId) throw new Error('containerId required to run preset');
              const runId = enqueueTask({ presetId: pid, containerId: args.containerId, overrides: args.vars || {}, scheduledAt: args.runAt ? Date.parse(String(args.runAt)) : undefined });
              logger.event('ai.chat.enqueue_by_request', { request_id: requestId, presetId: pid, runId }, 'info');
              const planCandidatesOut = routerOut ? [routerOut] : [];
              return res.json({ text: JSON.stringify({ ok:true, runId }), intent: parsed, outcome: { ok:true, runId }, planCandidates: planCandidatesOut, autoExecuted: false });
            } else if (capabilityKey === 'run_preset') {
              const pid = Number(args.presetId || args.id);
              if (!pid) throw new Error('presetId required for run_preset');
              if (!args.containerId) throw new Error('containerId required');
              const runId = enqueueTask({ presetId: pid, containerId: args.containerId, overrides: args.vars || {}, scheduledAt: args.runAt ? Date.parse(String(args.runAt)) : undefined });
              logger.event('ai.chat.enqueue_by_request', { request_id: requestId, presetId: pid, runId }, 'info');
              const planCandidatesOut = routerOut ? [routerOut] : [];
              return res.json({ text: JSON.stringify({ ok:true, runId }), intent: parsed, outcome: { ok:true, runId }, planCandidates: planCandidatesOut, autoExecuted: false });
            }
          } catch (e:any) {
            logger.event('ai.chat.enqueue_err', { request_id: requestId, err: String(e) }, 'warn');
            // fallthrough to normal handling (will return error later if needed)
          }
        }

        // Mode-aware auto-execution logic
        const planMode = routerOut && typeof (routerOut as any).mode === 'string' ? String((routerOut as any).mode).toLowerCase() : null;
        // Safety classification for capabilities
        const SAFE_CAPS = new Set<string>([
          'list_containers',
          'preset_create_empty',
          'task_create',
          'group_assign_members',
          'task_query_status',
          'task_list_recent'
        ]);
        const DANGEROUS_CAPS = new Set<string>([
          'run_preset',
          'task_run_now',
          'bulk_like_post',
          'task_delete'
        ]);
        let canAuto = false;
        let needsConfirm = false;
        let needsClarify = false;
        const HIGH_CONF_LOCAL = Number(process.env.AUTO_EXEC_CONF_HIGH || 0.9);
        const MID_CONF_LOCAL = Number(process.env.AUTO_EXEC_CONF_MID || 0.7);

        if (planMode === 'execute' && capabilityKey) {
          // If capability is explicitly dangerous, require confirm even if mode says execute
          if (DANGEROUS_CAPS.has(String(capabilityKey))) {
            needsConfirm = true;
            canAuto = false;
          } else if (SAFE_CAPS.has(String(capabilityKey))) {
            canAuto = true;
          } else {
            // default to confirm for unknown capabilities
            needsConfirm = true;
          }
        } else if (planMode === 'confirm' && capabilityKey) {
          needsConfirm = true;
        } else if (planMode === 'clarify') {
          needsClarify = true;
        } else {
          const canAutoByConfidence = effectiveConfidence >= HIGH_CONF_LOCAL;
          const canAutoByDecision = routerDecision && (String(routerDecision).toLowerCase() === 'execute' || String(routerDecision).toLowerCase() === 'accept' || String(routerDecision).toLowerCase() === 'run');
          if (capabilityKey && (canAutoByConfidence || canAutoByDecision)) {
            canAuto = true;
          } else if (capabilityKey && effectiveConfidence >= MID_CONF_LOCAL) {
            needsConfirm = true;
          }
        }

        const planCandidatesOut = routerOut ? [routerOut] : [];

        if (canAuto) {
          // Prepare args: give precedence to router arguments, fall back to parsed.args
          const args = Object.assign({}, parsed && parsed.args ? parsed.args : {}, capabilityArgs || {});
          if (ctxIdFromReq && !args.contextId) args.contextId = ctxIdFromReq;
          try {
            // If planner provided multi-step `steps`, prefer Task-based execution
            if (routerOut && Array.isArray(routerOut.steps) && routerOut.steps.length > 0) {
              // Immediate execute on high confidence + execute decision
              if ((routerDecision && String(routerDecision).toLowerCase() === 'execute') && effectiveConfidence >= HIGH_CONF) {
                const task = createTask(requestId, routerOut);
                try {
                  const runRes = await runTask(task.id);
                  const resultSummary = { status: runRes.status, stepsExecuted: runRes.logs.length };
                  // compute likedCount if present in logs
                  let likedCount = 0;
                  try {
                    for (const l of runRes.logs || []) {
                      if (l && l.capability === 'x_like_recent_posts' && l.result) {
                        const v = l.result.liked || l.result.likedCount || l.result.liked || 0;
                        likedCount += Number(v || 0);
                      }
                    }
                  } catch {}
                  if (likedCount) (resultSummary as any).likedCount = likedCount;
                  // write audit log
                  try {
                    const p = path.resolve('logs', 'chat_confirm.jsonl');
                    const stepsLog = (runRes.logs || []).map((l:any) => ({ capability: l.capability, args: l.args || {}, ok: !!l.ok, error: l.error || undefined }));
                    appendJsonl(p, { ts: Date.now(), sessionId: requestId, plan: routerOut, taskId: task.id, steps: stepsLog, resultSummary });
                  } catch (le) { /* ignore logging errors */ }
                  logger.event('ai.chat.task_run', { request_id: requestId, taskId: task.id, status: runRes.status }, 'info');
                  const messageId = genMessageId(requestId);
                  // save assistant message
                  // build human-friendly assistant text for task run result
                  let assistantText = `タスク実行を完了しました。状態: ${runRes.status}、実行ステップ数: ${runRes.logs.length}`;
                  if (likedCount) assistantText += `、いいね数: ${likedCount}`;
                  try {
                    dbRun('INSERT INTO chat_messages(session_id,message_id,role,text,meta_json,created_at) VALUES(?,?,?,?,?,?)', [sessionId, messageId, 'assistant', assistantText, JSON.stringify({ intent: parsed, planCandidates: planCandidatesOut }), Date.now()]);
                  } catch (e:any) {}
                  return res.json({ text: assistantText, intent: parsed, outcome: { ok:true, taskId: task.id }, planCandidates: planCandidatesOut, autoExecuted: true, taskId: task.id, resultSummary, messageId, sessionId: sessionId });
                } catch (e:any) {
                  logger.event('ai.chat.task_err', { request_id: requestId, err: String(e) }, 'error');
                  return res.status(500).json({ error: String(e?.message || e) });
                }
              } else {
                // Need user confirmation: create waiting task and log for audit
                const task = createTask(requestId, routerOut);
                task.status = 'waiting_confirm';
                // append to chat_confirm.jsonl for auditing and UI
                try {
                  const p = path.resolve('logs', 'chat_confirm.jsonl');
                  appendJsonl(p, { ts: Date.now(), sessionId: requestId, plan: routerOut, taskId: task.id, steps: routerOut.steps || null, resultSummary: { status: 'waiting_confirm' } });
                } catch (e:any) { /* ignore logging errors */ }
                // return a human-readable summary asking for confirmation
                const stepSummaries = (routerOut.steps || []).map((s:any, idx:number) => `${idx+1}. ${s.description || s.capability} (${JSON.stringify(s.arguments||{})})`).join('\n');
                const ask = `次の手順で実行してよいですか？\n${stepSummaries}`;
                const messageId = genMessageId(requestId);
                try {
                  dbRun('INSERT INTO chat_messages(session_id,message_id,role,text,meta_json,created_at) VALUES(?,?,?,?,?,?)', [sessionId, messageId, 'assistant', ask, JSON.stringify({ intent: parsed, planCandidates: planCandidatesOut }), Date.now()]);
                } catch (e:any) {}
                return res.json({ text: ask, intent: parsed, planCandidates: planCandidatesOut, taskId: task.id, waitingConfirm: true, messageId, sessionId: sessionId });
              }
            }
            // Special-case: single-step list_containers -> return container list directly
            const isListContainers = String(capabilityKey) === 'list_containers';
            const isExecuteLike = String(routerDecision).toLowerCase() === 'execute' || planMode === 'execute';
            if (routerOut && isListContainers && isExecuteLike) {
              try {
                // attempt to scan common container directory
                const baseDir = defaultCbDir();
                let containers = [];
                try { containers = await scanContainers(baseDir); } catch (ci) { containers = []; }
                const lines = (containers || []).map((c:any) => `- ${c.name || c.id} (id: ${c.id})`);
                const textList = lines.length ? (`利用可能なコンテナ一覧:\n${lines.join('\n')}`) : '利用可能なコンテナはありませんでした。';

                // build capabilities list for response (reuse existing merge logic)
                const memCaps = Array.isArray(memGet('capabilities')) ? memGet('capabilities') : [];
                const dbCaps = listEnabled().map((c:any) => ({ key: c.key, title: c.title || c.key, description: c.description || '', params: c.params_json || null }));
                const presetCaps = PresetService.listPresets().map((p:any) => ({ key: `preset:${p.id}`, title: p.name, description: p.description || '' }));
                const byKey: Record<string, any> = {};
                for (const c of dbCaps) byKey[String(c.key)] = c;
                for (const c of memCaps) byKey[String(c.key)] = Object.assign({}, byKey[String(c.key)] || {}, c);
                for (const p of presetCaps) { if (!byKey[p.key]) byKey[p.key] = p; }
                const capabilitiesOut = Object.values(byKey);
                const presetOnly = presetCaps.filter(pc => !capabilitiesOut.find((c:any) => c.key === pc.key));
                const finalCaps = capabilitiesOut.concat(presetOnly);

                const messageId = genMessageId(requestId);
                try {
                  dbRun('INSERT INTO chat_messages(session_id,message_id,role,text,meta_json,created_at) VALUES(?,?,?,?,?,?)', [sessionId, messageId, 'assistant', textList, JSON.stringify({ intent: parsed, planCandidates: planCandidatesOut }), Date.now()]);
                } catch (e) { /* ignore */ }
                return res.json({ text: textList, intent: parsed, planCandidates: planCandidatesOut, capabilities: finalCaps, messageId, sessionId: sessionId, autoExecuted: true });
              } catch (e:any) {
                logger.event('ai.chat.exec_err', { request_id: requestId, capability: capabilityKey, err: String(e) }, 'error');
                return res.json({ text: 'コンテナ一覧の取得中にエラーが発生しました。', intent: parsed, planCandidates: planCandidatesOut, capabilities: [], autoExecuted: false });
              }
            }
            // Special-case: create empty preset directly from planner (preset_create_empty)
            const isCreateEmpty = String(capabilityKey) === 'preset_create_empty';
            if (routerOut && isCreateEmpty) {
              try {
                // extract args from planner output with fallbacks
                const ra = routerOut.arguments || (routerOut as any).args || (routerOut as any).params || {};
                const nm = String((ra && ra.name) ? ra.name : (`preset-${Date.now()}`));
                const desc = String((ra && ra.description) ? ra.description : '');
                const out = PresetService.createPreset(nm, desc, JSON.stringify([]));
                logger.event('api.chat.preset_create_empty', { request_id: requestId, id: out.id, name: nm }, 'info');

                // build capabilities list for response (reuse existing merge logic)
                const memCaps2 = Array.isArray(memGet('capabilities')) ? memGet('capabilities') : [];
                const dbCaps2 = listEnabled().map((c:any) => ({ key: c.key, title: c.title || c.key, description: c.description || '', params: c.params_json || null }));
                const presetCaps2 = PresetService.listPresets().map((p:any) => ({ key: `preset:${p.id}`, title: p.name, description: p.description || '' }));
                const byKey2: Record<string, any> = {};
                for (const c of dbCaps2) byKey2[String(c.key)] = c;
                for (const c of memCaps2) byKey2[String(c.key)] = Object.assign({}, byKey2[String(c.key)] || {}, c);
                for (const p of presetCaps2) { if (!byKey2[p.key]) byKey2[p.key] = p; }
                const capabilitiesOut2 = Object.values(byKey2);
                const presetOnly2 = presetCaps2.filter(pc => !capabilitiesOut2.find((c:any) => c.key === pc.key));
                const finalCaps2 = capabilitiesOut2.concat(presetOnly2);

                const messageId2 = genMessageId(requestId);
                const textMsg = `新しい空のプリセットを作成しました: (id: ${out.id}, name: ${nm})\n必要に応じてステップ編集画面からステップを追加してください。`;
                try {
                  dbRun('INSERT INTO chat_messages(session_id,message_id,role,text,meta_json,created_at) VALUES(?,?,?,?,?,?)', [sessionId, messageId2, 'assistant', textMsg, JSON.stringify({ intent: parsed, planCandidates: planCandidatesOut }), Date.now()]);
                } catch (ee) { /* ignore */ }
                return res.json({ text: textMsg, intent: parsed, planCandidates: planCandidatesOut, capabilities: finalCaps2, messageId: messageId2, sessionId: sessionId, autoExecuted: true, outcome: { ok:true, id: out.id, name: nm } });
              } catch (e:any) {
                logger.event('api.chat.preset_create_empty.err', { request_id: requestId, err: String(e) }, 'error');
                return res.status(500).json({ error: 'preset_create_empty_failed', detail: String(e) });
              }
            }
            // Fallback: handle single-capability or primitive capabilities as before
            let outcome: any = null;
            if (String(capabilityKey).startsWith('preset:')) {
              // run preset by id
              const pid = Number(String(capabilityKey).split(':')[1]);
              if (!pid) throw new Error('invalid preset id in capability');
              if (!args.containerId) throw new Error('containerId required to run preset');
              const runId = enqueueTask({ presetId: pid, containerId: args.containerId, overrides: args.vars || {}, scheduledAt: args.runAt ? Date.parse(String(args.runAt)) : undefined });
              outcome = { ok:true, runId };
            } else if (capabilityKey === 'create_preset') {
              const nm = String(args.name || `preset-${Date.now()}`);
              const desc = String(args.description || '');
              const out = PresetService.createPreset(nm, desc, JSON.stringify(args.steps || []));
              outcome = { ok:true, id: out.id };
            } else if (capabilityKey === 'run_preset') {
              const pid = Number(args.presetId || args.id);
              if (!pid) throw new Error('presetId required for run_preset');
              if (!args.containerId) throw new Error('containerId required');
              const runId = enqueueTask({ presetId: pid, containerId: args.containerId, overrides: args.vars || {}, scheduledAt: args.runAt ? Date.parse(String(args.runAt)) : undefined });
              outcome = { ok:true, runId };
            } else {
              // fallback to executor dispatch for supported primitive capabilities
              outcome = await dispatch({ capability: String(capabilityKey), args });
            }
            logger.event('ai.chat.res', { request_id: requestId, capability: capabilityKey, outcome, autoExec: true }, 'info');
            const messageId = genMessageId(requestId);
            try {
              const assistantText = outcome && outcome.ok ? `操作は成功しました: ${JSON.stringify(outcome)}` : `操作でエラーが発生しました: ${String(outcome && outcome.error || JSON.stringify(outcome))}`;
              dbRun('INSERT INTO chat_messages(session_id,message_id,role,text,meta_json,created_at) VALUES(?,?,?,?,?,?)', [sessionId, messageId, 'assistant', assistantText, JSON.stringify({ intent: parsed, planCandidates: planCandidatesOut }), Date.now()]);
            } catch (e:any) {}
            return res.json({ text: outcome && outcome.ok ? `操作は成功しました: ${JSON.stringify(outcome)}` : `操作でエラーが発生しました: ${String(outcome && outcome.error || JSON.stringify(outcome))}`, intent: parsed, outcome, planCandidates: planCandidatesOut, autoExecuted: true, messageId, sessionId: sessionId });
          } catch (e:any) {
            logger.event('ai.chat.exec_err', { request_id: requestId, capability: capabilityKey, err: String(e), stack: e?.stack }, 'error');
            return res.status(500).json({ error: String(e?.message || e) });
          }
        }
      } catch (e:any) {
        logger.event('ai.chat.exec_decide.err', { err: String(e) }, 'warn');
      }
    } catch (ie) {
      // parsing must not block normal chat flow
      logger.event('api.chat.intent_error', { request_id: requestId, err: String(ie) }, 'warn');
    }

    const tempToSend = await decideTemperatureToSend(mdl, temperature);
    const DEFAULT_MAX = Number(process.env.CHAT_MAX_TOKENS || 1200);
    function clampMaxLocal(x:number){ return Math.max(100, Math.min(Number(process.env.CHAT_MAX_HARD_CAP || 4000), Math.floor(x))); }
    const rawMax = (typeof max_completion_tokens === 'number') ? max_completion_tokens : DEFAULT_MAX;
    const maxk = clampMaxLocal(rawMax);
    const reqTimeout = Number(process.env.OPENAI_REQ_TIMEOUT_MS || 65000);
    const ctl = new AbortController();
    const guard = setTimeout(()=>ctl.abort(), reqTimeout);
    try {
      logger.event('api.chat.start', { request_id: requestId, model: mdl, maxRequested: maxk, messages_count: 1 }, 'info');
    // Build chat options and only include temperature when defined (avoid sending unsupported param)
    const chatOpts: any = { model: mdl, system, user, signal: ctl.signal, request_timeout_ms: reqTimeout };
    if (typeof tempToSend !== 'undefined') chatOpts.temperature = tempToSend;

    // Helper: single chatText call with specified max tokens
    async function safeChatTextOnce(opts: { model: string; system?: string; user: any; maxTokens: number; signal?: AbortSignal; request_timeout_ms?: number }) {
      return await chatText({ model: opts.model, system: opts.system, user: opts.user, max_completion_tokens: opts.maxTokens, signal: opts.signal, request_timeout_ms: opts.request_timeout_ms });
    }

    // Retry wrapper: try once, on max_tokens error increase tokens once and retry, otherwise fallback to empty text
    async function runChatTextWithRetry(opts: { model: string; system?: string; user: any; baseMaxTokens: number; signal?: AbortSignal; request_timeout_ms?: number }) : Promise<{ text: string; usedMaxTokens: number }> {
      const SOFT_MAX = Number(process.env.CHAT_TEXT_MAX_TOKENS_SOFT || 2048);
      let maxTokens = Math.min(Math.max(Number(opts.baseMaxTokens || 0) || 0, 600), SOFT_MAX);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const txt = await safeChatTextOnce({ model: opts.model, system: opts.system, user: opts.user, maxTokens, signal: opts.signal, request_timeout_ms: opts.request_timeout_ms });
          return { text: txt, usedMaxTokens: maxTokens };
        } catch (err:any) {
          const msg = String(err?.message || err || '');
          const isMaxTokensErr = msg.includes('max_tokens') || msg.toLowerCase().includes('model output limit');
          if (!isMaxTokensErr) throw err;
          logger.event('api.chat.max_tokens_retry', { model: opts.model, attempt, maxTokens, message: msg }, 'warn');
          const nextMax = Math.min(maxTokens * 2, SOFT_MAX);
          if (attempt === 0 && nextMax > maxTokens) {
            maxTokens = nextMax;
            continue;
          }
          logger.event('api.chat.max_tokens_fallback', { model: opts.model, maxTokens, message: msg }, 'warn');
          return { text: '', usedMaxTokens: maxTokens };
        }
      }
      return { text: '', usedMaxTokens: maxTokens };
    }

    // Help-query detection: if user asked "what can you do" style, skip LLM and let UI render capabilities
    const helpRe = /できる事を教えて|できることを教えて|何ができるか教えて|どんなことができる\?/i;
    const utterText = typeof user === 'string' ? user : JSON.stringify(user);
    let text = '';
    if (!helpRe.test(utterText)) {
      const requested = Number(max_completion_tokens || DEFAULT_MAX || 800);
      const runRes = await runChatTextWithRetry({ model: mdl, system, user, baseMaxTokens: requested, signal: ctl.signal, request_timeout_ms: reqTimeout });
      text = runRes.text;
    } else {
      // skip calling LLM for help queries to avoid max_tokens errors; UI will use capabilities/planCandidates
      logger.event('api.chat.help_fallback', { request_id: requestId, utter: String(utterText).slice(0,120) }, 'info');
    }
      const ms = Date.now() - t0;
      logger.event('api.chat.ok', { request_id: requestId, modelUsed: mdl, maxUsed: maxk, ms, messages_count: 1 }, 'info');
      // include parsed intent and planCandidates if available
      // Provide capabilities list to the UI: prefer cached memGet('capabilities'), else use DB-enabled capabilities,
      // and always include presets as fallback if no capabilities are present.
      try {
        const memCaps = Array.isArray(memGet('capabilities')) ? memGet('capabilities') : [];
        const dbCaps = listEnabled().map((c:any) => ({ key: c.key, title: c.title || c.key, description: c.description || '', params: c.params_json || null }));
        const presetCaps = PresetService.listPresets().map((p:any) => ({ key: `preset:${p.id}`, title: p.name, description: p.description || '' }));
        // merge: DB caps first, then memCaps override by key, then presets appended (dedupe by key)
        const byKey: Record<string, any> = {};
        for (const c of dbCaps) byKey[String(c.key)] = c;
        for (const c of memCaps) byKey[String(c.key)] = Object.assign({}, byKey[String(c.key)] || {}, c);
        for (const p of presetCaps) {
          if (!byKey[p.key]) byKey[p.key] = p;
        }
        const capabilitiesOut = Object.values(byKey);
        // always include presets as well (even if duplicates exist)
        const presetOnly = presetCaps.filter(pc => !capabilitiesOut.find((c:any) => c.key === pc.key));
        let finalCaps = capabilitiesOut.concat(presetOnly);
        // ensure list_containers is discoverable in UI capabilities/help
        if (!finalCaps.find((c:any) => String(c.key) === 'list_containers')) {
          finalCaps = [{ key: 'list_containers', title: 'List containers', description: '利用可能なコンテナの一覧を取得する (コンテナ一覧)', params: JSON.stringify({ limit: 'number?' }) }].concat(finalCaps);
        }
        // If this was a help query, build a readable help text from capabilities
        if (!text && helpRe.test(utterText)) {
          const examplesFor: Record<string,string> = {
            show_help: '例: "できる事を教えて"',
            list_containers: '例: "コンテナの一覧を教えてください"',
            preset_create_empty: '例: "空のプリセットを作って"',
            group_assign_members: '例: "A001, A002 を alpha に分類して"',
            task_create: '例: "この投稿にいいねするタスクを作って"'
          };
          const lines = ['できること（ヘルプ）:'];
          for (const c of finalCaps) {
            const title = c.title || c.key;
            const desc = c.description ? ` — ${c.description}` : '';
            const ex = examplesFor[c.key] ? ` (${examplesFor[c.key]})` : '';
            lines.push(`- ${title}${desc}${ex}`);
          }
          text = lines.join('\n');
        }
        const messageId = genMessageId(requestId);
        try {
          dbRun('INSERT INTO chat_messages(session_id,message_id,role,text,meta_json,created_at) VALUES(?,?,?,?,?,?)', [sessionId, messageId, 'assistant', text || '', JSON.stringify({ intent: parsed, planCandidates: planCandidatesArr }), Date.now()]);
        } catch (e:any) {}
        res.json({ text, intent: parsed, planCandidates: planCandidatesArr, capabilities: finalCaps, messageId, sessionId: sessionId });
      } catch (e:any) {
        // fallback: return presets only
        const messageId = genMessageId(requestId);
        try {
          dbRun('INSERT INTO chat_messages(session_id,message_id,role,text,meta_json,created_at) VALUES(?,?,?,?,?,?)', [sessionId, messageId, 'assistant', text || '', JSON.stringify({ intent: parsed, planCandidates: planCandidatesArr }), Date.now()]);
        } catch (e:any) {}
        res.json({ text, intent: parsed, planCandidates: planCandidatesArr, capabilities: PresetService.listPresets().map(p=>({ key: `preset:${p.id}`, title: p.name })), messageId, sessionId: sessionId });
      }
    } finally { clearTimeout(guard); }
  } catch (e: any) {
    const ms = Date.now() - t0;
    logger.event('api.chat.fail', { request_id: requestId, ms, status: e?.status, code: e?.code, type: e?.type, param: e?.param, request_id_from_err: e?.request_id, msg: String(e?.message || e) }, 'error');
    logger.error(`chat error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || 'chat failed' });
  }
});

// Confirm endpoint: save conversation + proposed actions for auditing/learning and optionally trigger task registration
app.post('/api/chat/confirm', async (req, res) => {
  try {
    const payload = req.body || {};
    const p = path.resolve('logs', 'chat_confirm.jsonl');
    // enrich payload with ts and, if possible, associated task/plan/resultSummary
    const entry: any = Object.assign({}, payload);
    entry.ts = Date.now();
    try {
      if (entry.taskId) {
        const t = getTask(String(entry.taskId));
        if (t) {
          entry.plan = entry.plan || t.plannerResult || null;
          entry.steps = entry.steps || (t.logs || []).map((l:any) => ({ capability: l.capability, args: l.args || {}, ok: !!l.ok, error: l.error || undefined }));
          entry.resultSummary = entry.resultSummary || { status: t.status, stepsExecuted: (t.logs || []).length };
        }
      }
    } catch {}
    appendJsonl(p, entry);
    // dataset tap removed
    res.json({ ok:true });
  } catch (e:any) { logger.event('api.chat.confirm.err', { err: String(e?.message||e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Feedback endpoint for chat messages
app.post('/api/chat/feedback', async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = String(body.sessionId || '');
    const messageId = String(body.messageId || '');
    const role = String(body.role || 'assistant');
    const feedback = String(body.feedback || '').toLowerCase();
    const reason = body.reason ? String(body.reason) : null;
    if (!sessionId || !messageId) return res.status(400).json({ ok:false, error: 'sessionId and messageId required' });
    if (!(feedback === 'good' || feedback === 'bad')) return res.status(400).json({ ok:false, error: 'feedback must be "good" or "bad"' });
    try {
      dbRun('INSERT INTO chat_feedback(session_id,message_id,role,feedback,reason,created_at) VALUES(?,?,?,?,?,?)', [sessionId, messageId, role, feedback, reason, Date.now()]);
    } catch (e:any) {
      logger.event('chat.feedback.db.err', { err: String(e?.message||e), sessionId, messageId }, 'error');
      return res.status(500).json({ ok:false, error: 'db error' });
    }
    return res.json({ ok:true });
  } catch (e:any) {
    logger.event('api.chat.feedback.err', { err: String(e?.message||e) }, 'error');
    return res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

// 健康チェック
app.get('/api/health', (req, res) => {
  const dbPath = path.resolve('storage', 'app.db');
  const shotsDir = path.resolve('shots');
  let shotsCount = 0;
  try {
    shotsCount = fs.readdirSync(shotsDir).filter(f => f.toLowerCase().endsWith('.png')).length;
  } catch {}
  res.json({ ok: true, dbPath, shotsDir, shotsCount });
});

app.get('/api/settings', (_req, res) => {
  try {
    res.json({ ok: true, settings: currentSettings });
  } catch (e:any) {
    logger.event('api.settings.get.err', { err: String(e?.message || e) }, 'error');
    res.status(500).json({ ok:false, error: 'settings_load_failed' });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const body = req.body || {};
    const updates: Partial<AppSettings> = {};
    if (typeof body.dashboardPort !== 'undefined') {
      const parsed = Number(body.dashboardPort);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return res.status(400).json({ ok:false, error: 'dashboardPort invalid' });
      updates.dashboardPort = Math.round(parsed);
    }
    if (typeof body.containerBrowserPort !== 'undefined') {
      const parsed = Number(body.containerBrowserPort);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return res.status(400).json({ ok:false, error: 'containerBrowserPort invalid' });
      updates.containerBrowserPort = Math.round(parsed);
    }
    if (typeof body.containerBrowserHost !== 'undefined') {
      const host = String(body.containerBrowserHost).trim();
      if (!host) return res.status(400).json({ ok:false, error: 'containerBrowserHost invalid' });
      updates.containerBrowserHost = host;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ ok:false, error: 'nothing_to_update' });
    persistSettings(updates);
    res.json({ ok: true, settings: currentSettings, notice: '設定は保存されました。再起動して反映してください。' });
  } catch (e:any) {
    logger.event('api.settings.post.err', { err: String(e?.message || e) }, 'error');
    res.status(500).json({ ok:false, error: 'settings_save_failed' });
  }
});

function scheduleExit(reason: 'stop' | 'restart') {
  setExecutionEnabled(false);
  logger.event('system.shutdown', { reason }, reason === 'restart' ? 'info' : 'warn');
  setTimeout(() => { process.exit(0); }, 600);
}

app.post('/api/system/stop', (_req, res) => {
  scheduleExit('stop');
  res.json({ ok:true, reason:'stop' });
});

app.post('/api/system/restart', (_req, res) => {
  scheduleExit('restart');
  res.json({ ok:true, reason:'restart' });
});

// Chat history API for dashboard (reads chat_messages by session)
app.get('/api/chat/history', (req, res) => {
  const sessionId = String(req.query.sessionId || 'browser-session-1');
  const limitRaw = Number(req.query.limit || 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;
  try {
    const rows = dbQuery<any>('SELECT session_id, message_id, role, text, meta_json, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?', [sessionId, limit]);
    const messages = (rows || []).map((r:any) => ({
      session_id: r.session_id,
      message_id: r.message_id,
      role: r.role,
      text: r.text,
      meta_json: (() => { try { return r.meta_json ? JSON.parse(r.meta_json) : null } catch { return r.meta_json || null } })(),
      created_at: r.created_at
    }));
    return res.json({ ok: true, messages });
  } catch (e:any) {
    logger.event('api.chat.history.err', { sessionId, err: String(e) }, 'error');
    return res.status(500).json({ ok:false, error: 'history_failed' });
  }
});

// Rate an assistant message (good/bad) and store rating in chat_messages.meta_json
app.post('/api/chat/rate', (req, res) => {
  try {
    const { sessionId, messageId, rating, comment } = req.body || {};
    if (!sessionId || !messageId || !rating) return res.status(400).json({ ok:false, error: 'sessionId,messageId,rating required' });
    if (!(rating === 'good' || rating === 'bad')) return res.status(400).json({ ok:false, error: 'rating must be "good" or "bad"' });
    const rows = dbQuery<any>('SELECT meta_json FROM chat_messages WHERE session_id = ? AND message_id = ? LIMIT 1', [sessionId, messageId]);
    if (!rows || !rows.length) return res.status(404).json({ ok:false, error: 'message_not_found' });
    let meta: any = {};
    try { meta = rows[0].meta_json ? JSON.parse(rows[0].meta_json) : {}; } catch { meta = {}; }
    meta = meta || {};
    meta.rating = rating;
    meta.ratingComment = (typeof comment === 'string' && comment.length) ? String(comment).slice(0,2000) : (comment === null ? null : String(comment || ''));
    meta.ratingAt = Date.now();
    try {
      dbRun('UPDATE chat_messages SET meta_json = ? WHERE session_id = ? AND message_id = ?', [JSON.stringify(meta), sessionId, messageId]);
    } catch (e:any) {
      logger.event('api.chat.rate.err', { sessionId, messageId, err: String(e) }, 'error');
      return res.status(500).json({ ok:false, error: 'update_failed' });
    }
    logger.event('api.chat.rate', { sessionId, messageId, rating }, 'info');
    return res.json({ ok:true });
  } catch (e:any) {
    logger.event('api.chat.rate.err', { sessionId: String(req.body?.sessionId||''), messageId: String(req.body?.messageId||''), err: String(e) }, 'error');
    return res.status(500).json({ ok:false, error: 'rate_failed' });
  }
});

// posts 取得（shotUrl を付与）
app.get('/api/posts', (req, res) => {
  const limit = Number(req.query.limit || 20);
  const rows = dbQuery<any>('SELECT id,ts,platform,account,text_hash,url,result,evidence FROM posts ORDER BY id DESC LIMIT ?', [limit])
    .map((r: any) => ({ ...r, shotUrl: r.evidence ? (`/shots/${path.basename(r.evidence)}`) : null }));
  res.json(rows);
});

// recent task_runs (executed runs)
app.get('/api/task_runs', (req, res) => {
  try {
    const rawLimit = Number(req.query.limit || 50);
    const limit = Math.min(Math.max(1, rawLimit), 200);
    const offset = Math.max(0, Number(req.query.offset || 0));
    const rows = dbQuery<any>('SELECT id, runId, task_id, started_at, ended_at, status, result_json FROM task_runs ORDER BY started_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    // try to enrich with preset name if possible (join via tasks)
    const out = rows.map((r:any) => {
      let presetName = null;
      try {
        const t = dbQuery<any>('SELECT preset_id FROM tasks WHERE runId = ? LIMIT 1', [r.runId])[0];
        if (t && t.preset_id) {
          const p = PresetService.getPreset(Number(t.preset_id));
          if (p) presetName = p.name;
        }
      } catch {}
      return { ...r, presetName };
    });
    res.json({ ok: true, items: out, limit, offset, page: Math.floor(offset / limit) });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e) }); }
});

// containers list (from container-db)
app.get('/api/containers', (req, res) => {
  try {
    const dbPath = defaultContainerDb();
    const items = probeContainersFromDb(dbPath);
    // merge DB-backed group assignments if available, else fall back to memory assignments
    try {
      ensureContainerGroupsTables();
      const rows = dbQuery<any>('SELECT container_id, group_id FROM container_group_members', []);
      const dbAssign: Record<string, string|null> = {};
      for (const r of rows || []) {
        try { dbAssign[String(r.container_id)] = r.group_id || null; } catch {}
      }
      const memAssign: Record<string, string> = memGet('containerAssignments') || {};
      for (const it of items) {
        try {
          const cid = String((it as any).id || '');
          if (typeof dbAssign[cid] !== 'undefined') (it as any).groupId = dbAssign[cid];
          else (it as any).groupId = memAssign[cid] || null;
        } catch {}
      }
    } catch (e) { /* ignore */ }
    res.json({ ok:true, items });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Container groups: ensure tables then CRUD
function ensureContainerGroupsTables() {
  try {
    dbRun(`
      CREATE TABLE IF NOT EXISTS container_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
    `, []);
    dbRun(`
      CREATE TABLE IF NOT EXISTS container_group_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        container_id TEXT NOT NULL,
        group_id TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(container_id)
      );
    `, []);
  } catch (e) {
    // ignore - errors will be surfaced by callers
  }
}

app.get('/api/container-groups', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const rows = dbQuery<any>('SELECT id, name, description, color, created_at AS createdAt, updated_at AS updatedAt FROM container_groups ORDER BY name', []);
    res.json({ ok: true, items: rows });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.post('/api/container-groups', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const { name, description, color } = req.body || {};
    if (!name) return res.status(400).json({ ok:false, error: 'name required' });
    const id = `g-${Date.now()}-${Math.floor(Math.random()*9999)}`;
    const now = Date.now();
    dbRun('INSERT INTO container_groups(id,name,description,color,created_at,updated_at) VALUES(?,?,?,?,?,?)', [id, String(name), String(description||''), String(color||'#cccccc'), now, now]);
    const g = { id, name: String(name), description: String(description || ''), color: String(color || '#cccccc'), createdAt: now, updatedAt: now };
    res.json({ ok:true, group: g });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.put('/api/container-groups/:id', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const id = String(req.params.id || '');
    const { name, description, color } = req.body || {};
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    const now = Date.now();
    dbRun('UPDATE container_groups SET name=?, description=?, color=?, updated_at=? WHERE id=?', [String(name||''), String(description||''), String(color||'#cccccc'), now, id]);
    const g = dbQuery<any>('SELECT id, name, description, color, created_at AS createdAt, updated_at AS updatedAt FROM container_groups WHERE id = ?', [id])[0] || null;
    if (!g) return res.status(404).json({ ok:false, error: 'group not found' });
    res.json({ ok:true, group: g });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.delete('/api/container-groups/:id', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const id = String(req.params.id || '');
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    dbRun('DELETE FROM container_groups WHERE id = ?', [id]);
    // nullify assignments referencing this group
    dbRun('UPDATE container_group_members SET group_id = NULL, updated_at = ? WHERE group_id = ?', [Date.now(), id]);
    res.json({ ok:true, removed: 1 });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Bulk assign containers to a group (placed before single-assign to avoid route conflict)
app.post('/api/containers/bulk/group', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const { groupId, containerIds } = req.body || {};
    if (!Array.isArray(containerIds) || containerIds.length === 0) return res.status(400).json({ ok:false, error: 'containerIds required' });
    const now = Date.now();
    // Log request and insert all provided IDs (server will accept client-sent IDs)
    try { logger.event('api.container.bulk_assign.req', { groupId, containerIds }, 'info'); } catch {}
    try { memSet('lastBulkAssign', { ts: Date.now(), groupId, containerIds, headers: req.headers }); } catch(_) {}
    const tx = dbRun('BEGIN', []);
    try {
      for (const cid of containerIds) {
        dbRun('INSERT INTO container_group_members(container_id, group_id, created_at, updated_at) VALUES(?,?,?,?) ON CONFLICT(container_id) DO UPDATE SET group_id=excluded.group_id, updated_at=excluded.updated_at', [String(cid), (groupId==null)?null:String(groupId), now, now]);
      }
      dbRun('COMMIT', []);
      try { logger.event('api.container.bulk_assign.ok', { groupId, assigned: containerIds.length }, 'info'); } catch {}
      res.json({ ok:true, assigned: containerIds.length, invalid: [], groupId: groupId || null });
    } catch (e) {
      dbRun('ROLLBACK', []);
      try { logger.event('api.container.bulk_assign.err', { err: String(e), groupId }, 'error'); } catch {}
      throw e;
    }
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Assign single container to group (upsert)
app.post('/api/containers/:id/group', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const cid = String(req.params.id || '');
    const { groupId } = req.body || {};
    if (!cid) return res.status(400).json({ ok:false, error: 'container id required' });
    const now = Date.now();
    // use INSERT OR REPLACE to upsert based on UNIQUE(container_id)
    // Log and upsert without strict validation (accept IDs provided by client)
    try { logger.event('api.container.assign.req', { containerId: cid, groupId }, 'info'); } catch {}
    try { memSet('lastSingleAssign', { ts: Date.now(), containerId: cid, groupId, headers: req.headers }); } catch(_) {}
    dbRun('INSERT INTO container_group_members(container_id, group_id, created_at, updated_at) VALUES(?,?,?,?) ON CONFLICT(container_id) DO UPDATE SET group_id=excluded.group_id, updated_at=excluded.updated_at', [cid, (groupId==null)?null:String(groupId), now, now]);
    try { logger.event('api.container.assign.ok', { containerId: cid, groupId }, 'info'); } catch {}
    res.json({ ok:true, id: cid, groupId: groupId == null ? null : String(groupId) });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Bulk assign containers to a group
app.post('/api/containers/bulk/group', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const { groupId, containerIds } = req.body || {};
    if (!Array.isArray(containerIds) || containerIds.length === 0) return res.status(400).json({ ok:false, error: 'containerIds required' });
    const now = Date.now();
    // Log request and insert all provided IDs (server will accept client-sent IDs)
    try { logger.event('api.container.bulk_assign.req', { groupId, containerIds }, 'info'); } catch {}
    try { memSet('lastBulkAssign', { ts: Date.now(), groupId, containerIds, headers: req.headers }); } catch(_) {}
    const tx = dbRun('BEGIN', []);
    try {
      for (const cid of containerIds) {
        dbRun('INSERT INTO container_group_members(container_id, group_id, created_at, updated_at) VALUES(?,?,?,?) ON CONFLICT(container_id) DO UPDATE SET group_id=excluded.group_id, updated_at=excluded.updated_at', [String(cid), (groupId==null)?null:String(groupId), now, now]);
      }
      dbRun('COMMIT', []);
      try { logger.event('api.container.bulk_assign.ok', { groupId, assigned: containerIds.length }, 'info'); } catch {}
      res.json({ ok:true, assigned: containerIds.length, invalid: [], groupId: groupId || null });
    } catch (e) {
      dbRun('ROLLBACK', []);
      try { logger.event('api.container.bulk_assign.err', { err: String(e), groupId }, 'error'); } catch {}
      throw e;
    }
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Repair: remove or report member rows whose container_id is not present in container-db
app.post('/api/container-groups/repair-members', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const dbPath = defaultContainerDb();
    const available = probeContainersFromDb(dbPath).map(x => String(x.id));
    const validSet = new Set(available);
    const rows = dbQuery<any>('SELECT id, container_id FROM container_group_members', []);
    const toRemove: any[] = [];
    for (const r of rows || []) {
      const cid = String(r.container_id || '');
      if (!validSet.has(cid)) {
        toRemove.push({ id: r.id, containerId: cid });
      }
    }
    for (const t of toRemove) {
      try { dbRun('DELETE FROM container_group_members WHERE id = ?', [t.id]); } catch (e) { /* ignore */ }
    }
    res.json({ ok:true, removed: toRemove, remainingCount: dbQuery<any>('SELECT COUNT(*) AS c FROM container_group_members', [])[0]?.c || 0 });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// GET alias for repair (convenience)
app.get('/api/container-groups/repair-members', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const dbPath = defaultContainerDb();
    const available = probeContainersFromDb(dbPath).map(x => String(x.id));
    const validSet = new Set(available);
    const rows = dbQuery<any>('SELECT id, container_id FROM container_group_members', []);
    const toRemove: any[] = [];
    for (const r of rows || []) {
      const cid = String(r.container_id || '');
      if (!validSet.has(cid)) {
        toRemove.push({ id: r.id, containerId: cid });
      }
    }
    for (const t of toRemove) {
      try { dbRun('DELETE FROM container_group_members WHERE id = ?', [t.id]); } catch (e) { /* ignore */ }
    }
    res.json({ ok:true, removed: toRemove, remainingCount: dbQuery<any>('SELECT COUNT(*) AS c FROM container_group_members', [])[0]?.c || 0 });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Debug: dump groups and members (for troubleshooting)
app.get('/api/_debug/container-groups-full', (req, res) => {
  try {
    ensureContainerGroupsTables();
    const groups = dbQuery<any>('SELECT id, name, description, color, created_at AS createdAt, updated_at AS updatedAt FROM container_groups ORDER BY name', []);
    const members = dbQuery<any>('SELECT id, container_id AS containerId, group_id AS groupId, created_at AS createdAt, updated_at AS updatedAt FROM container_group_members ORDER BY id DESC LIMIT 100', []);
    res.json({ ok: true, groups, members });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Debug: return last received assign payloads (single and bulk)
app.get('/api/_debug/last-assigns', (req, res) => {
  try {
    const single = memGet('lastSingleAssign') || null;
    const bulk = memGet('lastBulkAssign') || null;
    res.json({ ok:true, single, bulk });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// 静的配信
app.use('/shots', express.static(path.resolve('shots'), { fallthrough: true, index: false }));
app.use('/logs', express.static(path.resolve('logs'), { fallthrough: true, index: false }));
app.use('/', express.static(path.resolve('public')));

// SSE: posts の増分通知
const clients: Array<import('express').Response> = [];
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  clients.push(res);
  req.on('close', () => { const i = clients.indexOf(res); if (i >= 0) clients.splice(i, 1); });
});

// selectors 一覧（site 指定が必須）
app.get('/api/selectors', (req, res) => {
  const site = String(req.query.site || '');
  if (!site) return res.status(400).json({ error: 'site is required' });
  const rows = dbQuery<any>('SELECT id, site_hash, key, success_rate, updated_at, locator_json FROM selectors WHERE site_hash = ? ORDER BY success_rate DESC, updated_at DESC LIMIT 100', [site]);
  res.json(rows.map(r => ({ ...r, candidates: (()=>{ try { return JSON.parse(r.locator_json||'[]'); } catch { return []; }})() })));
});

// capabilities list
// capabilities list (support GET for dashboard frontend and POST for programmatic use)
app.get('/api/capabilities', (req, res) => {
  try {
    const rows = listEnabled();
    res.json(rows);
  } catch (e:any) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/capabilities', (req, res) => {
  try {
    const rows = listEnabled();
    res.json(rows);
  } catch (e:any) { res.status(500).json({ error: String(e) }); }
});

// plan: return a plan JSON for given userText
app.post('/api/plan', async (req, res) => {
  try {
    const userText = String(req.body?.userText || '');
    const sid = String(req.body?.sessionId || 'default');
    const model = String(req.body?.model || process.env.NLU_MODEL || 'gpt-5-nano');
    const memSum = memorySummary(800);
    const context = { sessionId: sid, memory: memSum };
    logger.event('plan.req', { sessionId: sid, userText, model }, 'info');
    const plan = await router(userText, context);
    logger.event('plan.res', { sessionId: sid, plan }, 'info');
    res.json({ ok: true, model, plan });
  } catch (e:any) { logger.event('plan.err', { err: String(e) }, 'error'); res.status(500).json({ error: String(e) }); }
});

// act: execute a planned capability
app.post('/api/act', async (req, res) => {
  try {
    const cap = String(req.body?.capability || '');
    const args = req.body?.arguments || {};
    const sid = String(req.body?.sessionId || 'default');
    logger.event('act.req', { sessionId: sid, capability: cap, args }, 'info');
    const out = await dispatch({ capability: cap, args });
    logger.event('act.res', { sessionId: sid, capability: cap, out }, 'info');
    res.json(out);
  } catch (e:any) { logger.event('act.err', { err: String(e) }, 'error'); res.status(500).json({ error: String(e) }); }
});

// Profiles scanning/import endpoints
app.get('/api/profiles/scan', async (req, res) => {
  const dir = String(req.query.dir || '');
  if (!dir) return res.status(400).json({ error: 'dir is required' });
  const items = await scanContainers(dir);
  res.json({ ok:true, items });
});

app.get('/api/profiles/companion-dbs', async (req, res) => {
  const root = String(req.query.root || '');
  if (!root) return res.status(400).json({ error: 'root is required' });
  const items = await findCompanionDbs(root);
  res.json({ ok:true, items });
});

app.get('/api/profiles/inspect-db', async (req, res) => {
  const dbp = String(req.query.db || '');
  if (!dbp) return res.status(400).json({ error: 'db is required' });
  const out = await inspectDbSchema(dbp);
  res.json({ ok:true, out });
});

app.post('/api/profiles/import', (req, res) => {
  const items = req.body?.items || [];
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items required' });
  const { added, skipped } = importAccounts(items.map((i:any)=>({ name: i.name, dir: i.dir })));
  res.json({ ok:true, added, skipped });
});

// Proxy endpoints for export API
app.post('/api/export/restore', async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    logger.event('export.restore.start', { id }, 'info');
    try {
      logger.event('export.restore.check', { hasExportFunc: typeof exportRestored !== 'undefined' }, 'info');
    } catch (e) { logger.event('export.restore.check.err', { err: String(e) }, 'error'); }
    if (typeof exportRestored !== 'function') {
      logger.event('export.restore.err', { err: 'exportRestored not available' }, 'error');
      return res.status(500).json({ ok:false, error: 'exportRestored not available' });
    }
    logger.event('export.restore.call', { id }, 'info');
    try {
      // dynamic import to avoid any static resolution issues
      const mod = await import('../services/exportedProfiles');
      logger.event('export.restore.modloaded', { id, hasExport: typeof mod.exportRestored === 'function' }, 'info');
      if (typeof mod.exportRestored !== 'function') throw new Error('exportRestored not exported');
      const out = await mod.exportRestored(id, false);
    logger.event('export.restore.ok', { id, path: out.path, lastSessionId: out.lastSessionId || null, hasToken: !!out.token }, 'info');
    res.json({ ok:true, path: out.path, lastSessionId: out.lastSessionId || null, token: out.token || null });
    } catch (ie:any) {
      logger.event('export.restore.err', { err: String(ie), id }, 'error');
      return res.status(500).json({ ok:false, error: String(ie?.message||ie) });
    }
  } catch (e:any) { logger.event('export.restore.err', { err: String(e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.post('/api/export/delete', async (req, res) => {
  try {
    const { path: p } = req.body || {};
    if (!p) return res.status(400).json({ ok:false, error: 'path required' });
    const out = await deleteExported(p);
    res.json(out);
  } catch (e:any) { logger.event('export.delete.err', { err: String(e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Launch exported profile with local Electron executable
app.post('/api/export/launch-electron', async (req, res) => {
  try {
    const { path: profilePath, exePath } = req.body || {};
    if (!profilePath) return res.status(400).json({ ok:false, error: 'path required' });
    const exe = exePath || process.env.CONTAINER_BROWSER_EXE;
    if (!exe || !fs.existsSync(exe)) return res.status(400).json({ ok:false, error: 'electron exe not found; provide exePath or set CONTAINER_BROWSER_EXE' });
    // spawn electron with userDataDir
    const args = [`--user-data-dir=${profilePath}`];
    const child = child_process.spawn(exe, args, { detached: false, stdio: 'ignore' });
    // store handle
    spawnedMap.set(child.pid, child);
    // do not wait
    child.unref?.();
    logger.event('export.launch.electron', { pid: child.pid, exe, profilePath }, 'info');
    res.json({ ok:true, pid: child.pid });
  } catch (e:any) { logger.event('export.launch.err', { err: String(e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.post('/api/export/kill-process', async (req, res) => {
  try {
    const { pid } = req.body || {};
    if (!pid) return res.status(400).json({ ok:false, error: 'pid required' });
    try {
      const cp = spawnedMap.get(Number(pid));
      if (cp && !cp.killed) cp.kill();
      try { process.kill(Number(pid)); } catch {}
      spawnedMap.delete(Number(pid));
      logger.event('export.kill', { pid }, 'info');
      res.json({ ok:true });
    } catch (e:any) { throw e; }
  } catch (e:any) { logger.event('export.kill.err', { err: String(e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Proxy to execute commands on container-browser (click/type/navigate/eval)
app.post('/api/container/exec', async (req, res) => {
  try {
    const body = req.body || {};
    const { contextId, command } = body;
    if (!contextId || !command) return res.status(400).json({ ok:false, error: 'contextId and command are required' });
    // Reduce noisy logs: only emit request log at debug level; errors remain logged as 'error'
    logger.event('container.exec.req', { contextId, command }, 'debug');
    const { host, port } = getContainerExportConfig();
    const url = `http://${host}:${port}/internal/exec`;
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: Number(process.env.CONTAINER_EXEC_TIMEOUT_MS || 60000) });
    const j = await resp.json().catch(()=>({ ok:false, error: 'invalid-json' }));
    if (!resp.ok) {
      logger.event('container.exec.err', { contextId, command, status: resp.status, err: j?.error || 'remote error' }, 'error');
      return res.status(resp.status).json(j);
    }
    // Reduce noisy response logs: mark as debug to avoid flooding info-level logs.
    logger.event('container.exec.res', { contextId, command, ok: !!j.ok }, 'debug');
    // mask any sensitive fields in result if present
    if (j && j.cookies) {
      j.cookies = j.cookies.map((c:any)=> ({ name: c.name, domain: c.domain, path: c.path }));
    }
    res.json(j);
  } catch (e:any) { logger.event('container.exec.err', { err: String(e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Preset CRUD
app.get('/api/presets', (req, res) => {
  try {
    // debug: log which DB path the server thinks it's using (for troubleshooting)
    try { logger.event('api.presets.req', { dbPath: path.resolve('storage', 'app.db') }, 'info'); } catch {}
    const items = PresetService.listPresets();
    try {
      logger.event('api.presets.res', { count: Array.isArray(items) ? items.length : 0, sample: (Array.isArray(items) ? items.slice(0,3).map(p=>({ id: p.id, name: p.name })) : []) }, 'info');
    } catch (e) { /* ignore logging error */ }
    res.json({ ok: true, count: items.length, items });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.post('/api/presets', (req, res) => {
  try {
    const { name, description, steps } = req.body || {};
    if (!name || !steps) return res.status(400).json({ ok:false, error: 'name and steps are required' });
    const sjson = JSON.stringify(steps);
    const out = PresetService.createPreset(name, description||'', sjson);
    res.json({ ok: true, id: out.id });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.put('/api/presets/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, description, steps } = req.body || {};
    if (!id || !name || !steps) return res.status(400).json({ ok:false, error: 'id,name,steps required' });
    PresetService.updatePreset(id, name, description||'', JSON.stringify(steps));
    res.json({ ok: true });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.delete('/api/presets/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    PresetService.deletePreset(id);
    res.json({ ok: true });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Run preset (sequential execution)
app.post('/api/presets/:id/run', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { accountName } = req.body || {};
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    const preset = PresetService.getPreset(id);
    if (!preset) return res.status(404).json({ ok:false, error: 'preset not found' });
    const { steps, defaultTimeoutSeconds } = parsePresetStepsJson(preset.steps_json || '[]');
    // sequentially execute via container-browser internal exec
    const { host, port } = getContainerExportConfig();
    for (let i=0;i<steps.length;i++) {
      const st = steps[i];
      const cmdPayload: any = { contextId: accountName || st.contextId || preset.id, command: st.type };
      if (st.type === 'navigate') cmdPayload.url = st.url;
      if (st.type === 'click' || st.type === 'type') cmdPayload.selector = st.selector;
      if (st.type === 'type') cmdPayload.text = st.text;
      const options = Object.assign({}, (st.options && typeof st.options === 'object') ? st.options : {});
      options.timeoutMs = resolveStepTimeoutMs(st, defaultTimeoutSeconds);
      cmdPayload.options = options;
      const url = `http://${host}:${port}/internal/exec`;
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cmdPayload) });
      const j = await resp.json().catch(()=>({ ok:false, error:'invalid-json' }));
      const stepResult = (j && j.result && typeof j.result === 'object') ? j.result : null;
      const didAction = stepResult && typeof stepResult.didAction === 'boolean' ? stepResult.didAction : undefined;
      const actionStopped = typeof didAction === 'boolean' && didAction === false;
      const ok = !!j.ok;
      const okFlag = ok && !actionStopped;
      const runError = actionStopped ? (stepResult?.reason || 'didAction:false') : (j.error || 'error');
      PresetService.recordJobRun(null, id, i, JSON.stringify(st), okFlag, j, okFlag ? null : runError, j && j.elapsedMs ? j.elapsedMs : 0);
      if (st.expected) {
        const exp = st.expected;
        if (exp.urlContains && !(j.url||'').includes(exp.urlContains)) {
          return res.status(500).json({ ok:false, error: 'expected url not matched', got: j.url });
        }
        if (exp.htmlContains && !(j.html||'').includes(exp.htmlContains)) {
          return res.status(500).json({ ok:false, error: 'expected html not matched' });
        }
      }
      if (!okFlag) {
        if (actionStopped) {
          return res.status(409).json({
            ok: false,
            error: 'step action stopped',
            status: 'stopped',
            reason: runError,
            stepIndex: i,
            result: j,
          });
        }
        return res.status(500).json({ ok:false, error: j.error || 'step failed', stepIndex: i, result: j });
      }
    }
    res.json({ ok:true });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.post('/api/presets/:id/debug-step', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    const { containerId, stepIndex, overrides, params } = req.body || {};
    if (!containerId) return res.status(400).json({ ok:false, error: 'containerId required' });
    const preset = PresetService.getPreset(id);
    if (!preset) return res.status(404).json({ ok:false, error: 'preset not found' });
    const parsedPreset = parsePresetStepsJson(preset.steps_json || '[]');
    const providedSteps = Array.isArray(req.body?.steps) ? req.body.steps : null;
    const effectiveSteps = (Array.isArray(providedSteps) && providedSteps.length) ? providedSteps : parsedPreset.steps;
    const { defaultTimeoutSeconds } = parsedPreset;
    const idx = Number(stepIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= effectiveSteps.length) {
      return res.status(400).json({ ok:false, error: 'invalid stepIndex' });
    }
    const st = effectiveSteps[idx];
    if (!st) return res.status(400).json({ ok:false, error: 'step not found' });
    const { host, port } = getContainerExportConfig();
    const templateVars: Record<string, any> = {};
    const mergeVars = (source: any) => {
      if (source && typeof source === 'object') {
        Object.keys(source).forEach((key) => {
          templateVars[key] = source[key];
        });
      }
    };
    if (params && typeof params === 'object') {
      mergeVars(params);
    }
    if (overrides && typeof overrides === 'object') {
      mergeVars(overrides.vars);
      mergeVars(overrides.params);
      mergeVars(overrides.payload);
      if (!Object.keys(templateVars).length) {
        mergeVars(overrides);
      }
    }
    const templateVarsFinal = Object.keys(templateVars).length ? templateVars : null;
    function applyTemplate(src: string | null | undefined, vars: Record<string, any> | undefined) {
      if (!src) return src;
      const s = String(src);
      const re = /\{\{([A-Za-z0-9_-]+)\}\}/g;
      const missing: string[] = [];
      const out = s.replace(re, (_, name) => {
        if (!vars || typeof vars[name] === 'undefined' || vars[name] === null) {
          missing.push(name);
          return '';
        }
        return String(vars[name]);
      });
      if (missing.length) throw new Error(`template variables missing: ${missing.join(',')}`);
      return out;
    }
    // normalize possible legacy shapes: prefer explicit type, fallback to command/action keys
    const cmdType = (st && (st.type || st.command || st.action)) ? (st.type || st.command || st.action) : null;
    if (!cmdType) {
      return res.status(400).json({ ok: false, error: 'step command missing or unknown', stepIndex: idx, step: st });
    }
    const cmdPayload: any = { contextId: containerId, command: cmdType };

    // resolve parameters with fallbacks (support legacy shapes)
    if (cmdType === 'navigate') {
      const raw = (overrides && typeof overrides === 'object' && overrides.url) ? overrides.url : (st.url || (st.params && st.params.url));
      if (!raw) return res.status(400).json({ ok: false, error: 'navigate step missing url', stepIndex: idx });
      cmdPayload.url = applyTemplate(raw, templateVarsFinal);
    }
    if (cmdType === 'eval') {
      const rawEval = (overrides && typeof overrides === 'object' && overrides.eval) ? overrides.eval : (st.code || st.eval || (st.params && (st.params.eval || st.params.code)));
      if (!rawEval) return res.status(400).json({ ok: false, error: 'eval missing', stepIndex: idx });
      cmdPayload.eval = applyTemplate(rawEval, templateVarsFinal);
    }
    if (cmdType === 'click' || cmdType === 'type') {
      const rawSel = (overrides && typeof overrides === 'object' && overrides.selector) ? overrides.selector : (st.selector || (st.params && st.params.selector));
      if (!rawSel) return res.status(400).json({ ok: false, error: 'click/type step missing selector', stepIndex: idx });
      cmdPayload.selector = applyTemplate(rawSel, templateVarsFinal);
    }
    if (cmdType === 'type') {
      cmdPayload.text = (overrides && typeof overrides === 'object' && typeof overrides.text === 'string') ? overrides.text : (st.text || (st.params && st.params.text) || '');
    }
    const stepOptions = (st.options && typeof st.options === 'object') ? Object.assign({}, st.options) : {};
    const options = Object.assign({}, stepOptions);
    options.timeoutMs = resolveStepTimeoutMs(st, defaultTimeoutSeconds);
    const reqOptions = (req.body && typeof req.body.options === 'object') ? req.body.options : {};
    if (reqOptions && typeof reqOptions === 'object') {
      if (typeof reqOptions.timeoutMs === 'number' && Number.isFinite(reqOptions.timeoutMs) && reqOptions.timeoutMs > 0) {
        options.timeoutMs = reqOptions.timeoutMs;
      }
      Object.assign(options, reqOptions);
    }
    cmdPayload.options = options;
    cmdPayload.options = options;
    logger.event('debug.exec', { presetId: id, containerId, stepIndex: idx, command: cmdType, payload: cmdPayload }, 'debug');
    try { logger.event('debug.exec_payload', { presetId: id, containerId, stepIndex: idx, payload: cmdPayload }, 'debug'); } catch (e) {}

    const url = `http://${host}:${port}/internal/exec`;

    // special-case: handle 'wait' on server side for debug-step (export-server may not support it)
    if (cmdType === 'wait') {
      // ms-based wait
      const msVal = (st && typeof st.ms === 'number' && st.ms > 0) ? Number(st.ms) : (req.body && req.body.options && typeof req.body.options.ms === 'number' ? Number(req.body.options.ms) : null);
      if (msVal) {
        await new Promise(r => setTimeout(r, msVal));
        const out = { ok: true, result: { waitedMs: msVal } };
        return res.json({ ok: true, result: out, sentPayload: cmdPayload, execUrl: url });
      }
      const selector = (st && (st.selector || (st.options && st.options.waitForSelector))) || (req.body && req.body.options && req.body.options.waitForSelector) || null;
      if (!selector) return res.status(400).json({ ok: false, error: 'wait requires ms or selector', stepIndex: idx });
      const timeoutMs = Number(cmdPayload.options && cmdPayload.options.timeoutMs ? cmdPayload.options.timeoutMs : 15000);
      const start = Date.now();
      let found = false;
      let lastResp = null;
      while (Date.now() - start < timeoutMs) {
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contextId: containerId, command: 'eval', eval: `!!document.querySelector(${JSON.stringify(selector)})` }) });
          const parsed = await r.json().catch(() => null);
          lastResp = parsed;
          // normalize possible responses: true, "true", { body: true }, { result: { found: true } }, { ok:true, body:true }, etc.
          const isTrue = parsed === true || parsed === 'true' || (parsed && (parsed.body === true || parsed.result === true || parsed === true || parsed.ok === true && (parsed.body === true || parsed.result === true)));
          if (isTrue) { found = true; break; }
        } catch (e) {
          // ignore and retry
        }
        await new Promise(r => setTimeout(r, 500));
      }
      const out = { ok: found, result: { found, lastResp } };
      return res.json({ ok: found, result: out, sentPayload: cmdPayload, execUrl: url });
    }

    // forward other commands to exec server
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmdPayload),
    });
    const data = await resp.json().catch(() => ({ ok:false, error:'invalid-json' }));
    try { logger.event('debug.exec_response', { presetId: id, containerId, stepIndex: idx, httpStatus: resp.status, response: data }, 'debug'); } catch (e) {}
    const ok = !!data.ok;
    const commandResult = {
      command: data?.command || cmdType,
      result: data?.result ?? null,
      didAction: Boolean(data?.result?.didAction),
      selector: data?.result?.selector ?? data?.selector ?? null,
      reason: data?.result?.reason ?? null,
      elapsedMs: Number(data?.result?.elapsedMs ?? data?.elapsedMs ?? null),
    };
    if (!ok) return res.status(500).json({ ok:false, error: data.error || 'step failed', result: data, commandResult, sentPayload: cmdPayload, execUrl: url });
    res.json({ ok:true, result: data, commandResult, sentPayload: cmdPayload, execUrl: url });
  } catch (e:any) {
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

// Run preset with overrides (containerId, url/accountUrl, schedule)
app.post('/api/presets/:id/run-with-overrides', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok:false, error: 'id required' });
    const preset = PresetService.getPreset(id);
    if (!preset) return res.status(404).json({ ok:false, error: 'preset not found' });
    const { containerId, url, accountUrl, runAt } = req.body || {};
    if (!containerId) return res.status(400).json({ ok:false, error: 'containerId required' });
    const overrides: any = {};
    if (url) overrides.url = url;
    if (accountUrl) overrides.accountUrl = accountUrl;
    const scheduledAt = runAt ? Date.parse(String(runAt)) : undefined;
    const runId = enqueueTask({ presetId: id, containerId, overrides, scheduledAt });
    // if scheduledAt in future, schedule enqueue later - enqueueTask currently starts worker immediately; for scheduling, caller may submit at appropriate time
    res.json({ ok:true, runId });
  } catch (e:any) { logger.event('preset.run.override.err', { err: String(e?.message||e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Return template vars needed by a preset (scan {{var}} in steps)
app.get('/api/ai/needed-vars', (req, res) => {
  try {
    const pid = Number(req.query.presetId || 0);
    if (!pid) return res.status(400).json({ ok:false, error: 'presetId required' });
    const p = PresetService.getPreset(pid);
    if (!p) return res.status(404).json({ ok:false, error: 'preset not found' });
    const steps = JSON.parse(p.steps_json || '[]');
    const re = /\{\{([A-Za-z0-9_-]+)\}\}/g;
    const vars = new Set<string>();
    for (const s of steps) {
      if (s.url) { let m; while ((m = re.exec(s.url)) !== null) vars.add(m[1]); }
      if (s.selector) { let m; while ((m = re.exec(s.selector)) !== null) vars.add(m[1]); }
    }
    res.json({ ok:true, vars: Array.from(vars) });
  } catch (e:any) { logger.event('api.ai.neededvars.err', { err: String(e?.message||e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// AI-created task endpoint: accepts proposal and registers task
const parseWaitMinutes = (val: unknown) => {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return 10;
    const parsed = Number(trimmed);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 10;
};

app.post('/api/ai/create-task', async (req, res) => {
  try {
    const { sessionId, presetId, containerId, containerIds, groupId, overrides, params, runMode, runAt, scheduledAt: scheduledAtOverride, dryRun } = req.body || {};
    if (!presetId) return res.status(400).json({ ok:false, error: 'presetId required' });
    const pid = Number(presetId);
    const preset = PresetService.getPreset(pid);
    if (!preset) return res.status(404).json({ ok:false, error: 'preset not found' });

    // helper to persist audit entry
    try {
      const p = path.resolve('logs', 'chat_confirm.jsonl');
      appendJsonl(p, { ts: Date.now(), sessionId: sessionId || null, action: 'ai.create_task', presetId: pid, containerId: containerId || null, containerIds: containerIds || null, groupId: groupId || null, overrides: overrides || null, runMode: runMode || 'immediate', dryRun: !!dryRun });
    } catch {}

    const tryParse = (val: unknown) => {
      if (typeof val === 'number') return Number.isFinite(val) ? val : undefined;
      if (typeof val === 'string') {
        const parsed = Date.parse(val);
        return Number.isNaN(parsed) ? undefined : parsed;
      }
      return undefined;
    };
    const scheduledAt = tryParse(runAt) ?? tryParse(scheduledAtOverride);
    const overridesPayload = (() => {
      if (overrides && typeof overrides === 'object' && Object.keys(overrides).length) return overrides;
      if (params && typeof params === 'object' && Object.keys(params).length) return params;
      return {};
    })();
    const runIds: string[] = [];
    const targetContainerIds: string[] = [];

    const waitMinutes = parseWaitMinutes(req.body?.waitMinutes);
    const queueForContainer = (cid: string | number | null | undefined, gid?: string | null) => {
      const normalized = cid == null ? '' : String(cid).trim();
      if (!normalized) return;
      const runId = enqueueTask({ presetId: pid, containerId: normalized, overrides: overridesPayload, scheduledAt, groupId: gid || undefined, waitMinutes });
      runIds.push(runId);
      targetContainerIds.push(normalized);
    };

    // If explicit single containerId provided, enqueue single
    if (containerId) {
      queueForContainer(containerId);
      return res.json({ ok:true, runIds, targetContainerIds });
    }

    // If containerIds array provided, enqueue each
    if (Array.isArray(containerIds) && containerIds.length > 0) {
      for (const cid of containerIds) queueForContainer(cid, groupId);
      return res.json({ ok:true, runIds, targetContainerIds });
    }

    // If a groupId provided, expand to member containers
    if (groupId) {
      const rows = dbQuery<any>('SELECT container_id FROM container_group_members WHERE group_id = ?', [String(groupId)]);
      const members = (rows || []).map(r => r && r.container_id).filter(Boolean);
      if (!members.length) return res.status(404).json({ ok:false, error: 'no containers found for group' });
      for (const cid of members) queueForContainer(cid, groupId);
      try { logger.event('api.ai.create_task.group', { groupId: String(groupId), containers: members.length }, 'info'); } catch (e) {}
      return res.json({ ok:true, runIds, targetContainerIds, groupId: String(groupId) });
    }

    return res.status(400).json({ ok:false, error: 'containerId, containerIds, or groupId required' });
  } catch (e:any) { logger.event('api.ai.create_task.err', { err: String(e?.message||e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Create a preset via AI/chat action (simple helper)
app.post('/api/ai/create-preset', (req, res) => {
  try {
    const { name, description } = req.body || {};
    const nm = (name && String(name).trim()) || (`preset-${Date.now()}`);
    const desc = (description && String(description).trim()) || '';
    const out = PresetService.createPreset(nm, desc, JSON.stringify([]));
    logger.event('api.ai.create_preset', { id: out.id, name: nm }, 'info');
    res.json({ ok: true, id: out.id, name: nm });
  } catch (e:any) {
    logger.event('api.ai.create_preset.err', { err: String(e) }, 'error');
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// Tasks API: list tasks, get runs, cancel
app.get('/api/tasks', (req, res) => {
  try {
    // Return recent tasks with latest run summary
    const rows = dbQuery<any>('SELECT id, runId, preset_id, container_id, overrides_json, scheduled_at, status, created_at, updated_at, group_id, wait_minutes FROM tasks ORDER BY created_at DESC LIMIT 100', []);
    const items = rows.map(r => {
      const runs = dbQuery<any>('SELECT id, runId, task_id, started_at, ended_at, status, result_json FROM task_runs WHERE runId = ? ORDER BY started_at DESC', [r.runId]);
      const last = runs && runs.length ? runs[0] : null;
        const waitMinutes = typeof r.wait_minutes === 'number' ? r.wait_minutes : (r.wait_minutes != null ? Number(r.wait_minutes) : 10);
        return {
        id: r.id,
        runId: r.runId,
        presetId: r.preset_id,
        presetName: null,
        containerId: r.container_id,
        overrides: (()=>{ try { return JSON.parse(r.overrides_json||'{}'); } catch { return {}; } })(),
        scheduled_at: r.scheduled_at,
          status: r.status,
        created_at: r.created_at,
        updated_at: r.updated_at,
        lastRun: last,
           groupId: r.group_id || null,
           waitMinutes
      };
    });
    // enrich preset names
    for (const it of items) {
      try {
        const p = PresetService.getPreset(Number(it.presetId));
        if (p) it.presetName = p.name;
      } catch {}
    }
    res.json({ ok:true, count: items.length, items });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.patch('/api/tasks/:taskId', (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    if (!taskId) return res.status(400).json({ ok:false, error: 'taskId required' });
    const row = dbQuery<any>('SELECT id FROM tasks WHERE id = ?', [taskId])[0];
    if (!row) return res.status(404).json({ ok:false, error: 'task not found' });
    const {
      presetId,
      containerId,
      groupId,
      overrides,
      params,
      scheduledAt,
      immediate,
    } = req.body || {};
    const tryParse = (val: unknown) => {
      if (typeof val === 'number') return Number.isFinite(val) ? val : undefined;
      if (typeof val === 'string') {
        const parsed = Number(val);
        if (!Number.isNaN(parsed)) return parsed;
        const asDate = Date.parse(val);
        return Number.isNaN(asDate) ? undefined : asDate;
      }
      return undefined;
    };
    const updates: string[] = [];
    const paramsArr: any[] = [];
    if (typeof presetId !== 'undefined' && presetId !== null) {
      updates.push('preset_id = ?');
      paramsArr.push(Number(presetId));
    }
    if (typeof containerId !== 'undefined') {
      updates.push('container_id = ?');
      paramsArr.push(containerId ? String(containerId) : null);
    }
    if (typeof groupId !== 'undefined') {
      updates.push('group_id = ?');
      paramsArr.push(groupId ? String(groupId) : null);
    }
    const overridesPayload = (() => {
      if (overrides && typeof overrides === 'object' && Object.keys(overrides).length) return overrides;
      if (params && typeof params === 'object' && Object.keys(params).length) return params;
      return null;
    })();
    if (overridesPayload) {
      updates.push('overrides_json = ?');
      paramsArr.push(JSON.stringify(overridesPayload));
    }
    const parsedScheduled = tryParse(scheduledAt);
    if (parsedScheduled) {
      updates.push('scheduled_at = ?');
      paramsArr.push(parsedScheduled);
    } else if (immediate) {
      updates.push('scheduled_at = ?');
      paramsArr.push(null);
    }
    const waitMinutesValue = typeof req.body?.waitMinutes !== 'undefined' ? parseWaitMinutes(req.body.waitMinutes) : null;
    if (waitMinutesValue !== null) {
      updates.push('wait_minutes = ?');
      paramsArr.push(waitMinutesValue);
    }
    if (!updates.length) {
      return res.status(400).json({ ok:false, error: 'no updates provided' });
    }
    updates.push('updated_at = ?');
    paramsArr.push(Date.now());
    paramsArr.push(taskId);
    dbRun(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, paramsArr);
    res.json({ ok:true, taskId });
  } catch (e:any) {
    logger.event('api.tasks.patch.err', { err: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.get('/api/tasks/execution', (_req, res) => {
  try {
    res.json({ ok:true, enabled: isExecutionEnabled() });
  } catch (e:any) {
    logger.event('api.tasks.execution.get.err', { err: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.post('/api/tasks/execution', (req, res) => {
  try {
    const body = req.body || {};
    const enabledFlag = typeof body.enabled === 'boolean' ? body.enabled : Boolean(body.enabled);
    const current = setExecutionEnabled(enabledFlag);
    res.json({ ok:true, enabled: current });
  } catch (e:any) {
    logger.event('api.tasks.execution.post.err', { err: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.get('/api/kv/:key', (req, res) => {
  try {
    const key = String(req.params.key || '');
    if (!key) return res.status(400).json({ ok:false, error: 'key required' });
    const stored = memGet(key);
    res.json({ ok:true, key, value: stored ?? null });
  } catch (e:any) {
    logger.event('api.kv.get.err', { err: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.post('/api/kv/:key', (req, res) => {
  try {
    const key = String(req.params.key || '');
    if (!key) return res.status(400).json({ ok:false, error: 'key required' });
    const { value } = req.body || {};
    if (typeof value === 'undefined') return res.status(400).json({ ok:false, error: 'value required' });
    memSet(key, value);
    res.json({ ok:true, key, value });
  } catch (e:any) {
    logger.event('api.kv.post.err', { err: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.get('/api/tasks/:runId/runs', (req, res) => {
  try {
    const runId = String(req.params.runId || '');
    if (!runId) return res.status(400).json({ ok:false, error: 'runId required' });
    logger.event('api.task_runs.detail.request', { runId }, 'info');
    const rows = dbQuery<any>('SELECT id, runId, task_id, started_at, ended_at, status, result_json FROM task_runs WHERE runId = ? ORDER BY started_at ASC', [runId]);
    logger.event('api.task_runs.detail.success', { runId, found: Array.isArray(rows) ? rows.length : 0 }, 'info');
    res.json({ ok:true, runId, items: rows });
  } catch (e:any) {
    logger.event('api.task_runs.detail.err', { runId: String(req.params.runId || ''), error: String(e?.message||e) }, 'error');
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.post('/api/tasks/:runId/cancel', (req, res) => {
  try {
    const runId = String(req.params.runId || '');
    if (!runId) return res.status(400).json({ ok:false, error: 'runId required' });
    // mark tasks with runId as cancelled
    dbRun('UPDATE tasks SET status = ? WHERE runId = ?', ['cancelled', runId]);
    res.json({ ok:true, runId });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// AI selector generation: accepts HTML (or snippet) and returns selector candidates
app.post('/api/ai/generate-selector', async (req, res) => {
  try {
    const { html, hint, mode } = req.body || {};
    if (!html) return res.status(400).json({ ok:false, error: 'html is required' });
    const trimmedHtml = String(html).slice(0, 4000);
    const purpose = String(mode || 'selector').toLowerCase();
    const model = process.env.DEFAULT_NLU_MODEL || 'gpt-5-nano';

    // Build system/user prompts per mode
    let system = '';
    let user = '';
    if (purpose === 'eval') {
      system = `あなたはWebページのDOM上で安全に要素を取得し操作する短い自己完結型のJavaScriptスニペット（即時実行関数）を生成する専門家です。返却は必ずJSONで行ってください。出力形式: {"candidates":[{"code":"(function(){...})()","score":0.0,"reason":"..."}, ...]}。各codeは例外をキャッチしてエラー情報を返すようにしてください。`;
      user = `HTMLスニペット:\n${trimmedHtml}\n\nヒント: ${hint||''}\n要求: 3〜5個の候補を返してください。各候補は短い説明(reason)とscore(0-1)を持ち、実行時に {ok:true, ...} か {error: '...'} を返すことを想定してください。`;
    } else if (purpose === 'xpath') {
      system = `あなたは与えられたHTML断片から堅牢で短いXPath式を生成する専門家です。出力は必ずJSONで、形式は {"candidates":[{"xpath":"...","score":0.0,"reason":"..."}, ...]} としてください。XPathはできるだけ短く、テキストや属性を混ぜて安定するようにしてください。`;
      user = `HTMLスニペット:\n${trimmedHtml}\n\nヒント: ${hint||''}\n要求: 3〜7個の候補を返してください。各候補に score(0-1) と短い理由を付けてください。`;
    } else {
      // default: css selector generation
      system = `あなたはWebページのDOMから堅牢なCSSセレクタを生成する専門家です。返却は必ずJSONで行ってください。出力形式: {"candidates":[{"selector":"...","score":0.0,"reason":"..."}, ...]}。セレクタはできるだけ汎用的かつ具体的に。idがあれば #id を優先、なければタグ.クラス を組み合わせる。テキストベースの選択が推奨される場合は text= の形式も出してください。`;
      user = `HTMLスニペット:\n${trimmedHtml}\n\nヒント: ${hint||''}\n要求: 5個以内の候補を出し、それぞれにscore(0-1)と短い理由を付けてください。出力は必ずJSONオブジェクトで、鍵名は "candidates" としてください。`;
    }

    // Request structured JSON response from LLM; chatJson will set response_format for compatible models
    let out: any;
    try {
      out = await chatJson<any>({ model, system, user, responseJson: true, max_completion_tokens: 1400 });
      logger.event('ai.chat.success', { model, mode: purpose }, 'info');
    } catch (e:any) {
      logger.event('ai.chat.failure', { err: String(e?.message||e), model, mode: purpose }, 'error');
      throw e;
    }

    // Normalize parsed candidates
    let cands: any[] = [];
    if (out && Array.isArray((out as any).candidates)) {
      cands = (out as any).candidates;
    } else if (out && typeof out.raw === 'string') {
      try {
        const parsed = JSON.parse(out.raw);
        if (Array.isArray(parsed.candidates)) cands = parsed.candidates;
      } catch (ie) {
        // fallthrough
      }
    }

    // If no parsed candidates, return raw and include prompt for fallback copy
    if (!cands.length) {
      return res.json({ ok:true, candidates: [], raw: out, prompt: user });
    }

    res.json({ ok:true, candidates: cands, prompt: user });
  } catch (e:any) { logger.event('ai.selector.err', { err: String(e?.message||e) }, 'error'); res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// --- dataset tap utilities and endpoints ---
function ensureDirSync(dir: string) {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
}

function maskSensitive(text: string) {
  if (!text) return text;
  // mask OpenAI keys
  try { text = text.replace(/sk-[A-Za-z0-9-_]{20,}/g, 'sk-******'); } catch {};
  // mask long tokens
  try { text = text.replace(/[A-Za-z0-9-_]{40,}/g, '****'); } catch {};
  // mask Windows absolute paths keeping last 3 segments
  try { text = text.replace(/([A-Za-z]:\\[^\n\s]+)/g, (m) => {
    const parts = m.split('\\');
    if (parts.length <= 4) return m;
    return `...\\${parts.slice(-3).join('\\')}`;
  }); } catch {}
  return text;
}

function appendJsonl(p: string, obj: any) {
  ensureDirSync(path.dirname(p));
  const s = JSON.stringify(obj) + '\n';
  fs.appendFileSync(p, s, { encoding: 'utf8' });
  try { logger.event('dataset.tap', { evt: 'dataset.tap', path: p, bytes: Buffer.byteLength(s, 'utf8') }, 'info'); } catch {}
}

// dataset tap removed

// Accounts API: read accounts.json
app.get('/api/accounts', (req, res) => {
  try {
    const items = readAccounts();
    res.json({ ok:true, count: items.length, items });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e) }); }
});

// Open account by name (open profile)
app.post('/api/accounts/open', async (req, res) => {
  try {
    const { name, url, headless } = req.body || {};
    if (!name) return res.status(400).json({ ok:false, error:'name is required' });
    const items = readAccounts();
    const found = items.find(a => a.name === name);
    if (!found) return res.status(404).json({ ok:false, error:'account not found' });
    const out = await openWithProfile({ profilePath: found.profileUserDataDir, url: url || 'https://www.threads.net/', headless: !!headless });
    res.json({ ok:true, out });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Containers: read from container-browser DB
app.get('/api/containers/from-db', (req, res) => {
  const dbq = String(req.query.db || '').trim();
  const dbPath = dbq || defaultContainerDb();
  const triggerHdr = String((req.get && req.get('x-trigger')) || (req.headers && req.headers['x-trigger']) || '');
  logger.event('api.cb.fromdb.req', { db: dbPath, trigger: triggerHdr }, 'info');
  try {
    const rows = probeContainersFromDb(dbPath);
    logger.event('containers.from-db.ok', { dbPath, count: rows.length, trigger: triggerHdr }, 'info');
    logger.event('api.cb.fromdb.res', { db: dbPath, count: rows.length, trigger: triggerHdr }, 'info');
    res.json({ ok: true, dbPath, count: rows.length, items: rows });
  } catch (e:any) {
    logger.event('containers.from-db.err', { dbPath, err: String(e), stack: e?.stack, trigger: triggerHdr }, 'error');
    logger.event('api.cb.fromdb.err', { err: String(e), db: dbPath, trigger: triggerHdr }, 'error');
    res.status(500).json({ ok: false, dbPath, error: String(e), stack: e?.stack });
  }
});

// Explicit fetch trigger endpoint for reliable button logging
app.post('/api/containers/fetch-trigger', (req, res) => {
  const dbPath = String(req.body?.db || defaultContainerDb());
  logger.event('api.cb.fetch_trigger.req', { db: dbPath }, 'info');
  try {
    const rows = probeContainersFromDb(dbPath);
    logger.event('api.cb.fetch_trigger.res', { db: dbPath, count: rows.length }, 'info');
    res.json({ ok: true, db: dbPath, count: rows.length, items: rows });
  } catch (e: any) {
    logger.event('api.cb.fetch_trigger.err', { db: dbPath, err: String(e), stack: e?.stack }, 'error');
    res.status(500).json({ ok: false, db: dbPath, error: String(e) });
  }
});

// Open a container row directly via dir or partition
app.post('/api/containers/open-profile', async (req, res) => {
  try {
    const { dir, partition, url, headless } = req.body || {};
    let profilePath = (dir && String(dir).trim()) ? String(dir).trim() : undefined;
    const attemptedPaths: string[] = [];
    if (profilePath) attemptedPaths.push(profilePath);

    // If provided path does not exist, try partition-derived path(s)
    if ((!profilePath || !fs.existsSync(profilePath)) && partition) {
      const p1 = dirFromPartition(partition);
      attemptedPaths.push(p1);
      if (fs.existsSync(p1)) profilePath = p1;
    }

    // Try common alternative: defaultCbDir()/profiles/<base>
    if ((!profilePath || !fs.existsSync(profilePath)) && partition) {
      const base = String(partition || '').replace(/^persist:/, '');
      if (base) {
        const p2 = path.join(defaultCbDir(), 'profiles', base);
        attemptedPaths.push(p2);
        if (fs.existsSync(p2)) profilePath = p2;
      }
    }

    if (!profilePath || !fs.existsSync(profilePath)) {
      logger.event('api.cb.open_profile.req', { dir: dir, partition, attempted: attemptedPaths }, 'warn');
      return res.status(500).json({ ok:false, error: `profilePath does not exist; attempted: ${JSON.stringify(attemptedPaths)}` });
    }

    logger.event('api.cb.open_profile.req', { dir: profilePath, partition, url }, 'info');
    try {
      // obtain token: try keytar then fallback to token.enc (optional)
      const SERVICE_NAME = 'container-browser';
      const ACCOUNT_NAME = 'container-browser-token';
      let token: string | null = null;
      try { token = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME); } catch (e) { token = null; }
      if (!token) {
        const encPath = path.join(defaultCbDir(), 'token.enc');
        if (fs.existsSync(encPath)) {
          try {
            const raw = fs.readFileSync(encPath);
            const iv = raw.slice(0,12);
            const tag = raw.slice(12,28);
            const enc = raw.slice(28);
            const seed = (process.env.COMPUTERNAME || os.hostname() || 'local') + '::container-browser';
            const key = crypto.createHash('sha256').update(seed, 'utf8').digest();
            const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
            dec.setAuthTag(tag);
            token = Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
          } catch (e) { token = null; }
        }
      }
      if (!token) {
        // token is optional for export-restored flow; proceed without injection
        logger.event('api.cb.open_profile.warn', { warn: 'no token available, proceeding without auth injection', profilePath }, 'warn');
      }

      // open profile
      const out = await openWithProfile({ profilePath, url: url || 'https://www.threads.net/', headless: !!headless });

      // call auth.validate
      const BASE = process.env.AUTH_API_BASE || 'https://2y8hntw0r3.execute-api.ap-northeast-1.amazonaws.com/prod';
      const validateUrl = `${BASE.replace(/\/$/, '')}/auth/validate`;
      const device_id = `csp-${Date.now()}`;
      const resp = await fetch(validateUrl, { method:'POST', headers:{ 'Authorization': `Bearer ${token}`, 'Content-Type':'application/json' }, body: JSON.stringify({ device_id, device_info: { name: 'chatsocialpilot', hostname: os.hostname() } }) });
      if (!resp.ok) {
        logger.event('api.cb.open_profile.err', { err: 'auth.validate failed', status: resp.status }, 'error');
        return res.status(500).json({ ok:false, error: 'auth.validate failed' });
      }
      const sc = resp.headers.get('set-cookie');
      const cookiesToInject: any[] = [];
      if (sc) {
        const parts = sc.split(';').map(s=>s.trim());
        const [nv, ...attrs] = parts; const eq = nv.indexOf('=');
        if (eq > 0) {
          const name = nv.slice(0,eq); const value = nv.slice(eq+1);
          const cookie: any = { name, value, path:'/', domain:'www.threads.com', httpOnly:false, secure:true };
          for (const a of attrs) {
            const [ka, va] = a.split('='); if (!ka) continue; const k=ka.toLowerCase();
            if (k==='domain') cookie.domain=(va||'').replace(/^\./,'');
            if (k==='path') cookie.path=va||'/';
            if (k==='httponly') cookie.httpOnly=true;
            if (k==='secure') cookie.secure=true;
            if (k==='samesite') cookie.sameSite=(va||'Lax');
          }
          cookiesToInject.push(cookie);
        }
      }
      if (cookiesToInject.length === 0) {
        cookiesToInject.push({ name:'session', value: token, domain:'www.threads.com', path:'/', httpOnly:true, secure:true, sameSite:'Lax' });
      }

      // inject cookies
      try {
        await setCookiesInContext(out.contextId, cookiesToInject);
      } catch (e:any) {
        logger.event('api.cb.open_profile.err', { err: 'cookie inject failed', details: String(e?.message||e) }, 'error');
        return res.status(500).json({ ok:false, error: 'cookie inject failed' });
      }

      // restore tabs
      try {
        const dbPath = defaultContainerDb();
        const db = new Database(dbPath, { readonly: true });
        const r = db.prepare('SELECT lastSessionId FROM containers WHERE id=?').get(row.id);
        const lastSessionId = r && r.lastSessionId;
        if (lastSessionId) {
          const tabs = db.prepare('SELECT url,tabIndex FROM tabs WHERE sessionId = ? ORDER BY tabIndex, id').all(lastSessionId);
          const byIndex = new Map();
          for (const t of tabs) { const idx = t.tabIndex || 0; if (!byIndex.has(idx)) byIndex.set(idx, []); byIndex.get(idx).push(t.url); }
          for (const [idx, urls] of byIndex.entries()) {
            const candidate = urls.find((u:string)=>u && !u.startsWith('about:blank')) || urls[0];
            try { const page = await out.context.newPage(); await page.goto(candidate, { waitUntil: 'domcontentloaded' }); } catch (e:any) { logger.event('api.cb.open_profile.err', { err: 'tab restore failed', url: candidate, errMsg: String(e?.message||e) }, 'error'); return res.status(500).json({ ok:false, error: 'tab restore failed' }); }
          }
        }
      } catch (e:any) { logger.event('api.cb.open_profile.err', { err: 'restore read failed', errMsg: String(e?.message||e) }, 'error'); return res.status(500).json({ ok:false, error: 'restore read failed' }); }

      logger.event('api.cb.open_profile.res', { contextId: out?.contextId, pagesCount: out?.pagesCount, firstUrl: out?.firstUrl }, 'info');
      res.json({ ok:true, out, profilePath });
    } catch (e:any) {
      logger.event('api.cb.open_profile.err', { err: String(e), path: profilePath, attempted: attemptedPaths }, 'error');
      res.status(500).json({ ok:false, error: String(e?.message||e) });
    }
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

app.post('/api/containers/close-profile', async (req, res) => {
  try {
    const { dir, partition } = req.body || {};
    let profilePath = (dir && String(dir).trim()) || '';
    if (!profilePath && partition) {
      profilePath = dirFromPartition(String(partition));
    }
    if (!profilePath) return res.status(400).json({ ok:false, error: 'dir or partition required' });
    const closed = await closeContextById(profilePath);
    res.json({ ok:true, profilePath, closed });
  } catch (e:any) {
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

app.post('/api/export/close', async (req, res) => {
  try {
    const { containerId, timeoutMs } = req.body || {};
    if (!containerId) return res.status(400).json({ ok:false, error: 'containerId required' });
    const { host, port } = getContainerExportConfig();
    const url = `http://${host}:${port}/internal/export-restored/close`;
    const payload: any = { id: String(containerId) };
    if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      payload.timeoutMs = timeoutMs;
    }
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await resp.json().catch(() => ({ ok:false, error: 'invalid-json' }));
    if (!resp.ok) {
      try { logger.event('api.export.close.err', { containerId, status: resp.status, error: data?.error || 'remote error' }, 'error'); } catch (e) {}
      return res.status(resp.status).json(data);
    }
    try { logger.event('api.export.close.ok', { containerId, result: data }, 'info'); } catch (e) {}
    res.json(data);
  } catch (e:any) {
    try { logger.event('api.export.close.err', { containerId: req.body?.containerId || null, err: String(e) }, 'error'); } catch (e2) {}
    res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});

// Import a single container row by id into accounts.json (non-destructive)
app.post('/api/containers/import-one', (req, res) => {
  try {
    const { id, dbPath } = req.body || {};
    const resolvedDb = dbPath || defaultContainerDb();
    if (!id) return res.status(400).json({ ok:false, error:'id is required' });
    if (!fs.existsSync(resolvedDb)) return res.status(404).json({ ok:false, error:'db not found', dbPath: resolvedDb });
    logger.event('api.cb.import_one.req', { id, db: resolvedDb }, 'info');
    const db = new Database(resolvedDb, { readonly: true });
    const r = db.prepare(`SELECT id,name,userDataDir,partition FROM containers WHERE id=?`).get(id);
    if (!r) return res.status(404).json({ ok:false, error:'container not found' });
    const name = r.name || r.id;
    const dir = (r.userDataDir && String(r.userDataDir).trim()) ? r.userDataDir : dirFromPartition(r.partition);
    const existing = readAccounts();
    if (existing.some(a => a.name === name)) return res.json({ ok:true, added:false, reason:'exists', name, dir });
    existing.push({ name, profileUserDataDir: dir });
    writeAccounts(existing);
    logger.event('api.cb.import_one.res', { id, name, dir }, 'info');
    res.json({ ok:true, added:true, name, dir, total: existing.length });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});

// Import containers from DB into config/accounts.json (non-destructive)
app.post('/api/containers/import-from-db', (req, res) => {
  try {
    const dbPath = (req.body && req.body.dbPath) || defaultContainerDb();
    if (!fs.existsSync(dbPath)) return res.status(404).json({ ok:false, error:'db not found', dbPath });
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare(`SELECT id,name,userDataDir,partition FROM containers`).all();
    const existing = readAccounts();
    const byName = new Map(existing.map(a => [a.name, a]));
    let added = 0, skipped = 0;
    for (const r of rows) {
      const name = r.name || r.id;
      const dir = (r.userDataDir && String(r.userDataDir).trim()) ? r.userDataDir : dirFromPartition(r.partition);
      if (byName.has(name)) { skipped++; continue; }
      const acc = { name, profileUserDataDir: dir };
      existing.push(acc);
      byName.set(name, acc);
      added++;
    }
    writeAccounts(existing);
    res.json({ ok:true, dbPath, added, skipped, total: existing.length });
  } catch (e:any) { res.status(500).json({ ok:false, error: String(e?.message||e) }); }
});


// ルートは dashboard へリダイレクト
app.get('/', (_req, res) => res.redirect('/dashboard.html'));

let lastId = 0;
setInterval(() => {
  try {
    const rows = query<any>('SELECT id,ts,platform,account,result,evidence FROM posts WHERE id > ? ORDER BY id ASC', [lastId]);
    if (rows.length) {
      lastId = rows[rows.length - 1].id;
      const payload = JSON.stringify(rows.map((r: any) => ({ ...r, shotUrl: r.evidence ? (`/shots/${path.basename(r.evidence)}`) : null })));
      clients.forEach((c) => c.write(`event: posts\nid: ${lastId}\ndata: ${payload}\n\n`));
    }
  } catch {}
}, 1500);

app.listen(DASHBOARD_PORT, () => {
  logger.info(`Dashboard running → http://localhost:${DASHBOARD_PORT}`);
  logger.info(`Note: This server is intended for local use only.`);
  try {
    openDashboardInBrowser(DASHBOARD_PORT);
  } catch (e:any) {
    logger.event('dashboard.open_browser.err', { err: String(e?.message||e) }, 'warn');
  }
});

function openDashboardInBrowser(port: number) {
  if (!port) return;
  const target = `http://localhost:${port}/dashboard.html`;
  const platform = os.platform();
  let cmd: string;
  let args: string[];
  if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', target];
  } else if (platform === 'darwin') {
    cmd = 'open';
    args = [target];
  } else {
    cmd = 'xdg-open';
    args = [target];
  }
  const child = child_process.spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.unref?.();
}


