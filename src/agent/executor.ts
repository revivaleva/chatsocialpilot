import { run } from '../drivers/db';
import { openWithProfile, navigateInContext, clickInContext, typeInContext } from '../drivers/browser';
import { memSet } from './memory';
import { logger } from '../utils/logger';

export async function dispatch(opts: { capability: string; args: any }) {
  const t0 = Date.now();
  try {
    if (opts.capability === 'open_profile') {
      const out = await openWithProfile({ profilePath: opts.args.profilePath, url: opts.args.url, headless: !!opts.args.headless });
      run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), 'ok', Date.now()-t0, 1, Date.now()]);
      return { ok:true, out };
    }
    if (opts.capability === 'navigate') {
      const out = await navigateInContext(opts.args.contextId, opts.args.url);
      run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), 'ok', Date.now()-t0, 1, Date.now()]);
      return { ok:true, out };
    }
    if (opts.capability === 'click') {
      const out = await clickInContext(opts.args.contextId, opts.args.selector);
      run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), 'ok', Date.now()-t0, 1, Date.now()]);
      return { ok:true, out };
    }
    if (opts.capability === 'type') {
      const out = await typeInContext(opts.args.contextId, opts.args.selector, opts.args.text, { clear: !!opts.args.clear });
      run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), 'ok', Date.now()-t0, 1, Date.now()]);
      return { ok:true, out };
    }
    if (opts.capability === 'remember') {
      memSet(opts.args.key, opts.args.value, opts.args.type || 'fact');
      run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), 'ok', Date.now()-t0, 1, Date.now()]);
      return { ok:true };
    }
    // fallback
    run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), 'unsupported', Date.now()-t0, 0, Date.now()]);
    return { ok:false, error:'unsupported capability' };
  } catch (e:any) {
    run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), 'error', Date.now()-t0, 0, Date.now()]);
    logger.event('exec.err', { err: String(e), cap: opts.capability }, 'error');
    return { ok:false, error: String(e) };
  }
}




