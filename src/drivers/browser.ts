import { logger } from '../utils/logger';

/**
 * Container Browser ラッパー
 * 
 * Electron アプリ（Container Browser）の /internal/exec エンドポイント経由で
 * ブラウザを操作する。サポート: navigate, eval のみ。
 * 
 * Container Browser は http://127.0.0.1:3001 でリッスン（ローカルバインド）。
 */

const CONTAINER_BROWSER_HOST = process.env.CONTAINER_BROWSER_HOST || 'http://127.0.0.1:3001';

export interface ExecOptions {
  timeoutMs?: number;
  returnHtml?: boolean | 'trim';
  screenshot?: boolean;
  waitForSelector?: string;
}

export interface ExecResult {
  ok: boolean;
  body?: {
    result?: any;
    html?: string;
    screenshotPath?: string;
  };
  errorDetail?: {
    message: string;
    stack?: string;
  };
}

/**
 * Container Browser の /internal/exec エンドポイントを呼び出す
 */
async function execInContainer(
  contextId: string,
  command: 'navigate' | 'eval' | 'setFileInput',
  payload: any,
  options?: ExecOptions
): Promise<ExecResult> {
  try {
    const url = `${CONTAINER_BROWSER_HOST}/internal/exec`;
    const body: any = {
      contextId,
      command,
      ...payload,
      options: {
        timeoutMs: options?.timeoutMs || 30000,
        returnHtml: options?.returnHtml,
        screenshot: options?.screenshot,
        waitForSelector: options?.waitForSelector,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result: ExecResult = await response.json();
    return result;
  } catch (e: any) {
    logger.event('browser.exec.error', { contextId, command, err: String(e) }, 'error');
    return {
      ok: false,
      errorDetail: { message: String(e) },
    };
  }
}

/**
 * Container Browser でコンテナを開く
 * （既存の openWithProfile の代わり）
 */
export async function openContainer(opts: {
  id: string; // containerId
  ensureAuth?: boolean;
  timeoutMs?: number;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
}): Promise<{ ok: boolean; contextId: string; message?: string }> {
  try {
    const url = `${CONTAINER_BROWSER_HOST}/internal/export-restored`;
    const body: any = {
      id: opts.id,
      ensureAuth: opts.ensureAuth !== false,
      timeoutMs: opts.timeoutMs || 60000,
    };
    
    if (opts.proxy) {
      body.proxy = {
        server: opts.proxy.server,
        ...(opts.proxy.username && { username: opts.proxy.username }),
        ...(opts.proxy.password && { password: opts.proxy.password }),
      };
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorDetail = '';
      let errorJson: any = null;
      try {
        const errorBody = await response.text();
        errorDetail = errorBody.substring(0, 500); // 最初の 500 文字
        try {
          errorJson = JSON.parse(errorBody);
        } catch {}
      } catch {}
      
      // エラーレスポンスの詳細を取得
      const errorMessage = errorJson?.error || errorJson?.message || errorDetail || `HTTP ${response.status}`;
      throw new Error(`Failed to open container: HTTP ${response.status}. Response: ${errorMessage}`);
    }

    const result: any = await response.json();
    if (!result.ok) {
      // エラーメッセージを詳細に
      const errorMessage = result.error || result.message || 'Unknown error';
      throw new Error(errorMessage);
    }

    logger.info(`Container opened: ${opts.id}`);
    return {
      ok: true,
      contextId: opts.id,
      message: result.message,
    };
  } catch (e: any) {
    logger.event('browser.open.error', { id: opts.id, err: String(e) }, 'error');
    return {
      ok: false,
      contextId: opts.id,
      message: String(e),
    };
  }
}

/**
 * Container Browser でコンテナを新規作成
 */
export async function createContainer(opts: {
  name: string;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  timeoutMs?: number;
}): Promise<{ ok: boolean; containerId: string; message?: string }> {
  try {
    const url = `${CONTAINER_BROWSER_HOST}/internal/containers/create`;
    const body: any = {
      name: opts.name,
    };
    
    if (opts.proxy) {
      body.proxy = {
        server: opts.proxy.server,
        ...(opts.proxy.username && { username: opts.proxy.username }),
        ...(opts.proxy.password && { password: opts.proxy.password }),
      };
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorDetail = '';
      let errorJson: any = null;
      try {
        const errorBody = await response.text();
        errorDetail = errorBody.substring(0, 500);
        try {
          errorJson = JSON.parse(errorBody);
        } catch {}
      } catch {}
      
      const errorMessage = errorJson?.error || errorJson?.message || errorDetail || `HTTP ${response.status}`;
      throw new Error(`Failed to create container: HTTP ${response.status}. Response: ${errorMessage}`);
    }

    const result: any = await response.json();
    if (!result.ok) {
      const errorMessage = result.error || result.message || 'Unknown error';
      throw new Error(errorMessage);
    }

    // レスポンス構造: { ok: true, container: { id: "uuid", name: "name", ... } }
    const containerId = result.container?.id || result.containerId || result.id || opts.name;
    logger.info(`Container created: ${opts.name} (id: ${containerId})`);
    return {
      ok: true,
      containerId: containerId,
      message: result.message,
    };
  } catch (e: any) {
    logger.event('browser.create.error', { name: opts.name, err: String(e) }, 'error');
    return {
      ok: false,
      containerId: opts.name,
      message: String(e),
    };
  }
}

/**
 * Container を閉じる
 */
export async function closeContainer(opts: {
  id: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; closed: boolean }> {
  try {
    const url = `${CONTAINER_BROWSER_HOST}/internal/export-restored/close`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: opts.id,
        timeoutMs: opts.timeoutMs || 30000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to close container: HTTP ${response.status}`);
    }

    const result: any = await response.json();
    return {
      ok: result.ok,
      closed: result.closed !== false,
    };
  } catch (e: any) {
    logger.event('browser.close.error', { id: opts.id, err: String(e) }, 'error');
    return {
      ok: false,
      closed: false,
    };
  }
}

/**
 * コンテナ内で URL に移動
 * （既存の navigateInContext の代わり）
 */
export async function navigateInContext(
  contextId: string,
  url: string,
  options?: ExecOptions
): Promise<{ ok: boolean; url?: string; error?: string }> {
  // URL validation: empty or whitespace-only URLs are not allowed
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return { ok: false, error: 'navigate URL cannot be empty' };
  }

  const result = await execInContainer(contextId, 'navigate', { url }, options);

  if (!result.ok) {
    return { ok: false, error: result.errorDetail?.message };
  }

  const finalUrl = result.body?.result?.url || url;
  logger.info(`Navigated to ${finalUrl} in ${contextId}`);

  return { ok: true, url: finalUrl };
}

/**
 * コンテナ内で JavaScript コードを評価
 * （既存の複数操作を統合）
 */
export async function evalInContext(
  contextId: string,
  code: string,
  options?: ExecOptions & { returnHtml?: boolean | 'trim' }
): Promise<{ ok: boolean; result?: any; html?: string; error?: string }> {
  const result = await execInContainer(
    contextId,
    'eval',
    { eval: code },
    {
      timeoutMs: options?.timeoutMs,
      returnHtml: options?.returnHtml,
      screenshot: options?.screenshot,
    }
  );

  if (!result.ok) {
    return { ok: false, error: result.errorDetail?.message };
  }

  return {
    ok: true,
    result: result.body?.result,
    html: result.body?.html,
  };
}

/**
 * DOM セレクタをクリック（eval で実装）
 * （既存の clickInContext の代わり）
 */
export async function clickInContext(
  contextId: string,
  selector: string
): Promise<{ ok: boolean; error?: string }> {
  const code = `
    (async () => {
      try {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return { didAction: false, reason: 'selector not found' };
        el.click();
        await new Promise(r => setTimeout(r, 500));
        return { didAction: true, reason: 'clicked' };
      } catch (e) {
        return { didAction: false, reason: String(e) };
      }
    })()
  `;

  const result = await evalInContext(contextId, code);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const didAction = result.result?.didAction === true;
  return {
    ok: didAction,
    error: didAction ? undefined : result.result?.reason || 'action failed',
  };
}

/**
 * DOM セレクタにテキストを入力（eval で実装）
 * （既存の typeInContext の代わり）
 */
export async function typeInContext(
  contextId: string,
  selector: string,
  text: string,
  opts?: { clear?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const escapeText = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  const clearCmd = opts?.clear ? `el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true }));` : '';

  const code = `
    (async () => {
      try {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return { didAction: false, reason: 'selector not found' };
        
        // パスワード入力欄の場合は、focus()とclick()を呼び出してからキー入力をシミュレート
        const isPasswordField = el.type === 'password' || el.getAttribute('type') === 'password';
        
        if (isPasswordField) {
          // パスワード入力欄の場合: focus()とclick()を呼び出してからキー入力をシミュレート
          el.focus();
          el.click();
          await new Promise(r => setTimeout(r, 100));
          
          ${clearCmd ? 'el.value = \'\';' : ''}
          
          // 各文字に対してキー入力をシミュレート
          for (let i = 0; i < \`${escapeText}\`.length; i++) {
            const char = \`${escapeText}\`[i];
            el.value += char;
            
            // キーイベントを発火
            const keyEvent = new KeyboardEvent('keydown', { 
              key: char, 
              code: char.charCodeAt(0).toString(), 
              bubbles: true, 
              cancelable: true 
            });
            el.dispatchEvent(keyEvent);
            
            const inputEvent = new Event('input', { bubbles: true });
            el.dispatchEvent(inputEvent);
            
            await new Promise(r => setTimeout(r, 10));
          }
          
          // changeイベントを発火
          el.dispatchEvent(new Event('change', { bubbles: true }));
          
          await new Promise(r => setTimeout(r, 100));
        } else {
          // 通常の入力欄の場合: 既存の処理
          ${clearCmd}
          el.value += \`${escapeText}\`;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 300));
        }
        
        return { didAction: true, reason: 'text entered' };
      } catch (e) {
        return { didAction: false, reason: String(e) };
      }
    })()
  `;

  const result = await evalInContext(contextId, code);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const didAction = result.result?.didAction === true;
  return {
    ok: didAction,
    error: didAction ? undefined : result.result?.reason || 'action failed',
  };
}

/**
 * スクリーンショットを取得
 */
export async function captureScreenshot(
  contextId: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const result = await execInContainer(
    contextId,
    'eval',
    { eval: '({ screenshotRequested: true })' },
    { screenshot: true }
  );

  if (!result.ok) {
    return { ok: false, error: result.errorDetail?.message };
  }

  return {
    ok: true,
    path: result.body?.screenshotPath,
  };
}

/**
 * HTML を取得（状態判定用）
 * 
 * 既存の /internal/exec エンドポイントの returnHtml オプションを使用。
 * eval には無害な式（"null"）を指定し、options.returnHtml でHTMLを取得する。
 */
export async function getPageHtml(
  contextId: string,
  trim: boolean = true
): Promise<{ ok: boolean; html?: string; error?: string }> {
  const result = await execInContainer(
    contextId,
    'eval',
    { eval: 'null' }, // 無害な式（空文字列は不可）
    { returnHtml: trim ? 'trim' : true }
  );

  if (!result.ok) {
    logger.event('browser.getPageHtml.error', { 
      contextId, 
      error: result.errorDetail?.message,
      resultBody: JSON.stringify(result.body || {}).substring(0, 200)
    }, 'error');
    return {
      ok: false,
      error: result.errorDetail?.message || 'HTML取得に失敗しました',
    };
  }

  // レスポンス構造を確認: body.html または直接 html の可能性がある
  const html = result.body?.html || (result as any).html;
  
  if (!html) {
    logger.event('browser.getPageHtml.noHtml', { 
      contextId, 
      hasBody: !!result.body,
      bodyKeys: result.body ? Object.keys(result.body).join(',') : 'none',
      resultKeys: Object.keys(result).join(','),
      resultBody: JSON.stringify(result.body || {}).substring(0, 200),
      fullResult: JSON.stringify(result).substring(0, 500)
    }, 'warn');
    return {
      ok: false,
      error: 'HTMLが取得できませんでした（レスポンスにhtmlが含まれていません）',
    };
  }

  logger.event('browser.getPageHtml.success', { 
    contextId, 
    htmlLength: html.length 
  }, 'info');

  return {
    ok: true,
    html: html,
    error: undefined,
  };
}

/**
 * Container Browser のヘルスチェック
 */
export async function checkContainerBrowserHealth(): Promise<{
  ok: boolean;
  url?: string;
  error?: string;
}> {
  try {
    const url = `${CONTAINER_BROWSER_HOST}/health`;
    const response = await fetch(url, { method: 'GET' });
    
    if (response.ok) {
      return {
        ok: true,
        url: CONTAINER_BROWSER_HOST,
      };
    } else {
      return {
        ok: false,
        url: CONTAINER_BROWSER_HOST,
        error: `HTTP ${response.status}`,
      };
    }
  } catch (e: any) {
    return {
      ok: false,
      url: CONTAINER_BROWSER_HOST,
      error: String(e),
    };
  }
}
