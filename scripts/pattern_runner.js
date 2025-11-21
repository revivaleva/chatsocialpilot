#!/usr/bin/env node
/**
 * Simple pattern runner prototype
 * Usage: node scripts/pattern_runner.js patterns/sample_single_like.json --postUrl="..." --accountUrl="..."
 *
 * Notes:
 * - Requires Node 18+ (global fetch). If unavailable, install a fetch polyfill.
 * - Honors REMOTE_EXEC_HMAC env var (sha256 hex) when set.
 * - Saves run log to ./logs/run-<timestamp>.json and relies on server endpoints described in docs.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.CONTAINER_EXPORT_HOST || 'http://127.0.0.1:3001';

function nowTs() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function hmacHex(body) {
  const key = process.env.REMOTE_EXEC_HMAC;
  if (!key) return null;
  return crypto.createHmac('sha256', key).update(body).digest('hex');
}

async function postJson(endpoint, body) {
  const url = BASE + endpoint;
  const s = JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json' };
  const mac = hmacHex(s);
  if (mac) headers['x-remote-hmac'] = mac;
  const res = await fetch(url, { method: 'POST', headers, body: s });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, ok: res.ok, body: json };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function resolveParam(value, context) {
  if (typeof value !== 'string') return value;
  // simple placeholder replacement {{var}} from context
  return value.replace(/\{\{(.+?)\}\}/g, (_, key) => {
    return context[key] ?? '';
  });
}

function getFromStep(stepResults, ref) {
  // ref like "stepId.path.to.field" or just "stepId"
  if (!ref) return null;
  const parts = ref.split('.');
  const id = parts.shift();
  let obj = stepResults[id];
  if (!obj) return null;
  for (const p of parts) {
    if (obj && typeof obj === 'object') obj = obj[p];
    else return null;
  }
  return obj;
}

async function execCommand(contextId, command, params = {}, options = {}) {
  const body = { contextId, command, ...params, options };
  return await postJson('/internal/exec', body);
}

async function runPattern(pattern, overrides = {}) {
  const runId = `run-${pattern.patternId || 'unknown'}-${nowTs()}`;
  const logsDir = path.resolve(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const stepResults = {};
  const context = Object.assign({}, pattern.settings || {}, overrides || {});
  const containerId = context.containerId;

  const runLog = {
    runId,
    patternId: pattern.patternId,
    containerId,
    start: new Date().toISOString(),
    steps: []
  };

  // 1) open container (export-restored)
  try {
    const openResp = await postJson('/internal/export-restored', { id: containerId, ensureAuth: true, returnToken: false });
    runLog.open = openResp;
    if (!openResp.ok) {
      runLog.error = `export-restored failed: ${openResp.status}`;
      fs.writeFileSync(path.join(logsDir, `${runId}.json`), JSON.stringify(runLog, null, 2));
      console.error('export-restored failed', openResp);
      return runLog;
    }
  } catch (e) {
    runLog.error = String(e);
    fs.writeFileSync(path.join(logsDir, `${runId}.json`), JSON.stringify(runLog, null, 2));
    console.error('export-restored exception', e);
    return runLog;
  }

  // execute steps
  for (const step of pattern.steps || []) {
    const stepLog = { id: step.id, command: step.command, params: step.params || {}, startedAt: new Date().toISOString() };
    try {
      // evaluate runIf if present
      let shouldRun = true;
      if (step.runIf && step.runIf.stepId) {
        const target = getFromStep(stepResults, step.runIf.stepId);
        const path = (step.runIf.jsonPath || '').replace(/^\$\./, '');
        const val = path ? target && path.split('.').reduce((a, k) => a && a[k], target) : target;
        shouldRun = (val === step.runIf.equals);
      }
      if (!shouldRun) {
        stepLog.skipped = true;
        stepLog.endedAt = new Date().toISOString();
        runLog.steps.push(stepLog);
        continue;
      }

      // random delay between steps
      const delay = randBetween(context.delayMinMs || 0, context.delayMaxMs || 0);
      if (delay > 0) {
        stepLog.delayMs = delay;
        await sleep(delay);
      }

      // resolve params (simple placeholders)
      const params = {};
      for (const k of Object.keys(step.params || {})) {
        const v = step.params[k];
        if (k === 'selectorFromStep') {
          params['selector'] = getFromStep(stepResults, v);
        } else {
          params[k] = resolveParam(v, Object.assign({}, pattern.settings, overrides));
        }
      }

      let resp;
      switch (step.command) {
        case 'navigate':
          resp = await execCommand(containerId, 'navigate', { url: params.url }, { waitForSelector: params.waitForSelector, timeoutMs: params.timeoutMs });
          break;
        case 'click':
          if (context.dryRun) {
            resp = { status: 200, ok: true, body: { simulated: true, note: 'dryRun, click skipped', selector: params.selector } };
          } else {
            resp = await execCommand(containerId, 'click', { selector: params.selector }, { timeoutMs: params.timeoutMs });
          }
          break;
        case 'type':
          if (context.dryRun) {
            resp = { status: 200, ok: true, body: { simulated: true, note: 'dryRun, type skipped', text: params.text } };
          } else {
            resp = await execCommand(containerId, 'type', { selector: params.selector, text: params.text }, { timeoutMs: params.timeoutMs });
          }
          break;
        case 'eval':
          resp = await execCommand(containerId, 'eval', { eval: params.eval }, { timeoutMs: params.timeoutMs });
          break;
        case 'wait':
          if (params.ms) { await sleep(Number(params.ms)); resp = { status: 200, ok: true, body: { waitedMs: params.ms } }; }
          else if (params.selector) {
            // poll for selector presence
            const start = Date.now();
            const timeout = Number(params.timeoutMs || 15000);
            let found = false; let lastResp = null;
            while (Date.now() - start < timeout) {
              lastResp = await execCommand(containerId, 'eval', { eval: `!!document.querySelector(${JSON.stringify(params.selector)})` }, { timeoutMs: 5000 });
              if (lastResp && lastResp.body === true) { found = true; break; }
              await sleep(500);
            }
            resp = { status: 200, ok: true, body: { found } };
          } else {
            resp = { status: 200, ok: true, body: { note: 'wait no-op' } };
          }
          break;
        case 'screenshot':
          // ask server to capture screenshot by issuing a no-op exec with options.screenshot
          resp = await postJson('/internal/exec', { contextId: containerId, command: 'eval', eval: 'null', options: { screenshot: true } });
          break;
        case 'scroll':
          resp = await execCommand(containerId, 'eval', { eval: `window.scrollBy(0, ${Number(step.params.distance || 800)});` }, {});
          break;
        default:
          resp = { status: 400, ok: false, body: { error: 'unknown command' } };
      }

      stepLog.response = resp;
      stepLog.endedAt = new Date().toISOString();
      stepResults[step.id] = resp && resp.body;
      runLog.steps.push(stepLog);
    } catch (e) {
      stepLog.error = String(e);
      stepLog.endedAt = new Date().toISOString();
      runLog.steps.push(stepLog);
      if (pattern.settings && pattern.settings.stopOnError) {
        runLog.error = `step ${step.id} failed: ${e}`;
        break;
      }
    }
  }

  runLog.end = new Date().toISOString();
  fs.writeFileSync(path.join(process.cwd(), 'logs', `${runId}.json`), JSON.stringify(runLog, null, 2));
  console.log('Run finished:', runId, 'log:', path.join('logs', `${runId}.json`));
  return runLog;
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv[0]) {
    console.error('Usage: node scripts/pattern_runner.js <pattern.json> [--postUrl=...] [--accountUrl=...]');
    process.exit(1);
  }
  const patternPath = path.resolve(process.cwd(), argv[0]);
  if (!fs.existsSync(patternPath)) {
    console.error('pattern file not found:', patternPath);
    process.exit(1);
  }
  const raw = fs.readFileSync(patternPath, 'utf8');
  const pattern = JSON.parse(raw);
  const overrides = {};
  for (const a of argv.slice(1)) {
    if (a.startsWith('--postUrl=')) overrides.postUrl = a.split('=')[1];
    if (a.startsWith('--accountUrl=')) overrides.accountUrl = a.split('=')[1];
  }
  // inject placeholders if provided
  if (overrides.postUrl) {
    // replace any {{postUrl}} placeholders in steps
    for (const s of pattern.steps || []) {
      if (s.params && typeof s.params.url === 'string' && s.params.url.includes('{{postUrl}}')) {
        s.params.url = s.params.url.replace('{{postUrl}}', overrides.postUrl);
      }
      if (s.params && typeof s.params.url === 'string' && s.params.url.includes('{{accountUrl}}')) {
        s.params.url = s.params.url.replace('{{accountUrl}}', overrides.postUrl);
      }
    }
  }

  await runPattern(pattern, overrides);
}

main().catch((e) => { console.error(e); process.exit(1); });


