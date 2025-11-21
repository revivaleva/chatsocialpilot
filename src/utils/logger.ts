import fs from 'node:fs';
import path from 'node:path';
import winston from 'winston';

const APP_LOG = path.resolve('logs', `app-${new Date().toISOString().slice(0,10).replace(/-/g,'')}.log`);
const toFile = true;

function line(level: string, m: any) {
  const t = new Date().toISOString();
  const msg = typeof m === 'string' ? m : JSON.stringify(m);
  const out = `${t} [${level}] ${msg}`;
  if (level === 'error') process.stderr.write(out + '\n'); else process.stdout.write(out + '\n');
  if (toFile) fs.appendFile(APP_LOG, out + '\n', { encoding: 'utf8' }, ()=>{});
}

export type LogLevel = 'debug'|'info'|'warn'|'error';
const LV: Record<LogLevel, number> = { debug:10, info:20, warn:30, error:40 };
const ENV_LV = (process.env.LOG_LEVEL as LogLevel) || 'info';
function should(level: LogLevel) { return LV[level] >= LV[ENV_LV]; }

export function event(name: string, data: Record<string, any>, level: LogLevel='info') {
  if (!should(level)) return;
  const row = {
    ts: new Date().toISOString(),
    level,
    ev: name,
    ...data,
  };
  const lineStr = JSON.stringify(row) + '\n';
  if (level === 'error') process.stderr.write(lineStr); else process.stdout.write(lineStr);
  if (toFile) fs.appendFile(APP_LOG, lineStr, { encoding:'utf8' }, ()=>{});
}

export const logger = {
  debug: (m:any)=> { if (should('debug')) line('debug', typeof m==='string'?m:JSON.stringify(m)) },
  info:  (m:any)=> line('info', typeof m==='string'?m:JSON.stringify(m)),
  warn:  (m:any)=> line('warn', typeof m==='string'?m:JSON.stringify(m)),
  error: (m:any)=> line('error', typeof m==='string'?m:JSON.stringify(m)),
  event,
};

export default logger;

export function logErr(e: unknown, ctx = '') {
  const msg = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e);
  logger.error(`${ctx ? `[${ctx}] ` : ''}${msg}`);
}
