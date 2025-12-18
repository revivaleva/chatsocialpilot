import { run, memSet } from '../drivers/db';
import { openContainer, navigateInContext, clickInContext, typeInContext, evalInContext } from '../drivers/browser';
import { logger } from '../utils/logger';

/**
 * Executor Dispatch API
 * 
 * 利用可能な capability:
 * 
 * 1. open_container — コンテナを開く
 *    dispatch({ capability: 'open_container', args: { containerId: 'id', ensureAuth?: true } })
 * 
 * 2. navigate — URL に移動
 *    dispatch({ capability: 'navigate', args: { contextId: 'id', url: 'https://...' } })
 * 
 * 3. click — 要素をクリック
 *    dispatch({ capability: 'click', args: { contextId: 'id', selector: '.button' } })
 * 
 * 4. type — テキストを入力
 *    dispatch({ capability: 'type', args: { contextId: 'id', selector: 'input', text: '...' } })
 * 
 * 5. eval — JavaScript を実行
 *    dispatch({ capability: 'eval', args: { contextId: 'id', code: '...', returnHtml?: true } })
 * 
 * 6. remember — メモリに値を保存
 *    dispatch({ capability: 'remember', args: { key: '...', value: '...', type?: 'fact' } })
 */
export async function dispatch(opts: { capability: string; args: any }) {
  const t0 = Date.now();
  try {
    if (opts.capability === 'open_container') {
      // Container Browser でコンテナを開く
      const out = await openContainer({
        id: opts.args.containerId,
        ensureAuth: opts.args.ensureAuth,
        timeoutMs: opts.args.timeoutMs,
      });
      run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), out.ok ? 'ok' : 'error', Date.now()-t0, out.ok ? 1 : 0, Date.now()]);
      return { ok: out.ok, out };
    }

    if (opts.capability === 'navigate') {
      const out = await navigateInContext(opts.args.contextId, opts.args.url);
      run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), out.ok ? 'ok' : 'error', Date.now()-t0, out.ok ? 1 : 0, Date.now()]);
      return { ok: out.ok, out };
    }

    if (opts.capability === 'click') {
      const out = await clickInContext(opts.args.contextId, opts.args.selector);
      run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), out.ok ? 'ok' : 'error', Date.now()-t0, out.ok ? 1 : 0, Date.now()]);
      return { ok: out.ok, out };
    }

    if (opts.capability === 'type') {
      const out = await typeInContext(opts.args.contextId, opts.args.selector, opts.args.text, { clear: !!opts.args.clear });
      run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), out.ok ? 'ok' : 'error', Date.now()-t0, out.ok ? 1 : 0, Date.now()]);
      return { ok: out.ok, out };
    }

    if (opts.capability === 'eval') {
      // 直接 JavaScript を評価（HTML 分析など用）
      const out = await evalInContext(opts.args.contextId, opts.args.code, {
        timeoutMs: opts.args.timeoutMs,
        returnHtml: opts.args.returnHtml,
        screenshot: opts.args.screenshot,
      });
      run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), out.ok ? 'ok' : 'error', Date.now()-t0, out.ok ? 1 : 0, Date.now()]);
      return { ok: out.ok, out };
    }

    if (opts.capability === 'remember') {
      memSet(opts.args.key, opts.args.value, opts.args.type || 'fact');
      run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), 'ok', Date.now()-t0, 1, Date.now()]);
      return { ok: true };
    }

    // fallback
    run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), 'unsupported', Date.now()-t0, 0, Date.now()]);
    return { ok: false, error: 'unsupported capability' };
  } catch (e: any) {
    run('INSERT INTO run_history(capability_key,args_json,outcome,latency_ms,reward,created_at) VALUES(?,?,?,?,?,?)', [opts.capability, JSON.stringify(opts.args), 'error', Date.now()-t0, 0, Date.now()]);
    logger.event('exec.err', { err: String(e), cap: opts.capability }, 'error');
    return { ok: false, error: String(e) };
  }
}

