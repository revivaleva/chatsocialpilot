import { logger } from "../utils/logger";
import { loadSettings } from "../services/appSettings.js";

/**
 * Container Browser ラッパー
 *
 * Electron アプリ（Container Browser）の /internal/exec エンドポイント経由で
 * ブラウザを操作する。サポート: navigate, eval のみ。
 *
 * 接続先: 環境変数 CONTAINER_BROWSER_HOST が設定されていればそれを使用。
 * 未設定時は config/settings.json の containerBrowserHost と containerBrowserPort から構築する。
 */
function getContainerBrowserHost(): string {
  if (process.env.CONTAINER_BROWSER_HOST)
    return process.env.CONTAINER_BROWSER_HOST;
  const s = loadSettings();
  const host = s.containerBrowserHost || "127.0.0.1";
  const port = Number(s.containerBrowserPort ?? 3001);
  return `http://${host}:${port}`;
}

export interface ExecOptions {
  timeoutMs?: number;
  returnHtml?: boolean | "trim";
  screenshot?: boolean;
  waitForSelector?: string;
  returnCookies?: boolean;
}

export interface ExecResult {
  ok: boolean;
  command?: string;
  result?: any;
  html?: string;
  screenshotPath?: string;
  url?: string;
  title?: string;
  cookies?: any[];
  elapsedMs?: number;
  target?: { x: number; y: number };
  body?: any; // For backward compatibility if needed
  error?: string;
  errorDetail?: {
    message: string;
    stack?: string;
    line?: number;
    column?: number;
    snippet?: string;
    context?: string;
  };
}

/**
 * Container Browser の /internal/exec エンドポイントを呼び出す
 */
export async function execInContainer(
  contextId: string,
  command:
    | "navigate"
    | "eval"
    | "setFileInput"
    | "getElementRect"
    | "mouseMove"
    | "mouseClick"
    | "humanClick"
    | "setCookie"
    | "setNativeCookies"
    | "solveCaptcha",
  payload: any,
  options?: ExecOptions,
): Promise<ExecResult> {
  try {
    const url = `${getContainerBrowserHost()}/internal/exec`;
    const body: any = {
      contextId,
      command,
      ...payload,
      options: {
        timeoutMs: options?.timeoutMs || 30000,
        returnHtml: options?.returnHtml,
        screenshot: options?.screenshot,
        waitForSelector: options?.waitForSelector,
        returnCookies: options?.returnCookies,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result: ExecResult = await response.json();
    return result;
  } catch (e: any) {
    logger.event(
      "browser.exec.error",
      { contextId, command, err: String(e) },
      "error",
    );
    return {
      ok: false,
      errorDetail: { message: String(e) },
    };
  }
}

/**
 * Container Browser でコンテナを開く
 * @deprecated この関数は非推奨です。Container Browserの仕様変更により、`/internal/export-restored`エンドポイントは不要になりました。
 * コンテナが開いていない状態で`navigate`コマンドを実行すると、指定したURLでコンテナが自動的に開かれます。
 * 代わりに、最初の`navigate`ステップでコンテナを開きながらURLに移動してください。
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
  logger.event("browser.open.deprecated", { id: opts.id }, "warn");
  // 後方互換性のため、コンテナIDを返すだけ（実際には何もしない）
  return {
    ok: true,
    contextId: opts.id,
    message:
      "openContainer is deprecated. Container will be opened automatically on first navigate command.",
  };
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
  blockImages?: boolean;
  storage?: "local" | "cloud";
  device?: "desktop" | "mobile";
  os?: "windows" | "macos" | "linux" | "android" | "ios";
  browser?: "chrome" | "firefox" | "edge";
}): Promise<{ ok: boolean; containerId: string; message?: string }> {
  try {
    const host = getContainerBrowserHost();

    // 1. 既存のコンテナがないか名前で検索
    try {
      const listRes = await fetch(`${host}/internal/containers`);
      if (listRes.ok) {
        const data: any = await listRes.json();
        const existing = (data.containers || []).find((c: any) => c.name === opts.name);
        if (existing) {
          logger.info(`Existing container found: ${opts.name} (id: ${existing.id})`);
          return {
            ok: true,
            containerId: existing.id,
            message: "Existing container reused.",
          };
        }
      }
    } catch (e) {
      logger.warn(`Failed to check existing containers: ${e}`);
    }

    // 2. なければ新規作成
    const url = `${host}/internal/containers/create`;
    const body: any = {
      name: opts.name,
      blockImages: !!opts.blockImages,
      // Kameleo API v2 ではクラウドストレージをデフォルトとする
      storage: opts.storage || "cloud",
      device: opts.device || "desktop",
      os: opts.os || "windows",
      browser: opts.browser || "chrome",
    };

    if (opts.proxy) {
      // Kameleo v2 の proxy 形式（value/extra）に正規化
      body.proxy = {
        value: opts.proxy.server,
        extra: {
          username: opts.proxy.username || "",
          password: opts.proxy.password || "",
        },
      };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let errorDetail = "";
      let errorJson: any = null;
      try {
        const errorBody = await response.text();
        errorDetail = errorBody.substring(0, 500);
        try {
          errorJson = JSON.parse(errorBody);
        } catch { }
      } catch { }

      const errorMessage =
        errorJson?.error ||
        errorJson?.message ||
        errorDetail ||
        `HTTP ${response.status}`;
      throw new Error(
        `Failed to create container: HTTP ${response.status}. Response: ${errorMessage}`,
      );
    }

    const result: any = await response.json();
    if (!result.ok) {
      const errorMessage = result.error || result.message || "Unknown error";
      throw new Error(errorMessage);
    }

    // レスポンス構造: { ok: true, container: { id: "uuid", name: "name", ... } }
    const containerId =
      result.container?.id || result.containerId || result.id || opts.name;
    logger.info(`Container created: ${opts.name} (id: ${containerId})`);
    return {
      ok: true,
      containerId: containerId,
      message: result.message,
    };
  } catch (e: any) {
    logger.event(
      "browser.create.error",
      { name: opts.name, err: String(e) },
      "error",
    );
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
    const url = `${getContainerBrowserHost()}/internal/export-restored/close`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    logger.event(
      "browser.close.error",
      { id: opts.id, err: String(e) },
      "error",
    );
    return {
      ok: false,
      closed: false,
    };
  }
}

/**
 * Container を完全に削除する
 */
export async function deleteContainer(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${getContainerBrowserHost()}/internal/containers/delete`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete container: HTTP ${response.status}`);
    }

    const result: any = await response.json();
    return { ok: result.ok, error: result.error };
  } catch (e: any) {
    logger.event("browser.delete.error", { id, err: String(e) }, "error");
    return { ok: false, error: String(e) };
  }
}

/**
 * コンテナ内で URL に移動
 * （既存の navigateInContext の代わり）
 */
export async function navigateInContext(
  contextId: string,
  url: string,
  options?: ExecOptions,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  // URL validation: empty or whitespace-only URLs are not allowed
  if (!url || typeof url !== "string" || url.trim() === "") {
    return { ok: false, error: "navigate URL cannot be empty" };
  }

  const result = await execInContainer(contextId, "navigate", { url }, options);

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
  options?: ExecOptions & { returnHtml?: boolean | "trim" },
): Promise<{
  ok: boolean;
  result?: any;
  html?: string;
  error?: string;
  screenshotPath?: string;
  errorDetail?: ExecResult["errorDetail"];
}> {
  const result = await execInContainer(
    contextId,
    "eval",
    { eval: code },
    {
      timeoutMs: options?.timeoutMs,
      returnHtml: options?.returnHtml,
      screenshot: options?.screenshot,
    },
  );

  if (!result.ok) {
    return {
      ok: false,
      error: result.errorDetail?.message || result.error || "eval failed",
      errorDetail: result.errorDetail,
      screenshotPath: result.screenshotPath,
    };
  }

  return {
    ok: true,
    result: result.result,
    html: result.html,
    error: result.error,
    screenshotPath: result.screenshotPath,
  };
}

/**
 * DOM セレクタをクリック（eval で実装）
 * （既存の clickInContext の代わり）
 */
export async function clickInContext(
  contextId: string,
  selector: string,
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
    error: didAction ? undefined : result.result?.reason || "action failed",
  };
}

/**
 * 人間らしいマウス操作によるクリックを実行
 */
export async function humanClickInContext(
  contextId: string,
  selector: string,
  options?: ExecOptions & { offsetX?: number; offsetY?: number },
): Promise<{ ok: boolean; target?: { x: number; y: number }; error?: string }> {
  const result = await execInContainer(
    contextId,
    "humanClick",
    {
      selector,
      offsetX: options?.offsetX,
      offsetY: options?.offsetY,
    },
    options,
  );

  if (!result.ok) {
    return {
      ok: false,
      error: result.errorDetail?.message || "humanClick failed",
    };
  }

  // container-browser のレスポンスは { ok: true, command: 'humanClick', target: { x, y } }
  return {
    ok: true,
    target: result.target,
  };
}

/**
 * 指定した座標までマウスを（必要に応じて曲線で）移動
 */
export async function mouseMoveInContext(
  contextId: string,
  x: number,
  y: number,
  options?: ExecOptions & { steps?: number },
): Promise<{ ok: boolean; error?: string }> {
  const result = await execInContainer(
    contextId,
    "mouseMove",
    { x, y },
    { ...options, timeoutMs: options?.timeoutMs },
  );
  return { ok: result.ok, error: result.errorDetail?.message };
}

/**
 * 指定した座標で物理クリック（mouseDown -> delay -> mouseUp）を実行
 */
export async function mouseClickInContext(
  contextId: string,
  x: number,
  y: number,
  options?: ExecOptions & { delayMs?: number },
): Promise<{ ok: boolean; error?: string }> {
  const result = await execInContainer(
    contextId,
    "mouseClick",
    { x, y },
    { ...options, timeoutMs: options?.timeoutMs },
  );
  return { ok: result.ok, error: result.errorDetail?.message };
}

/**
 * type コマンドを contenteditable 対応の eval コードに変換する。
 * Container Browser の type が contenteditable で効かない場合、command: "eval" でこのコードを送れば入力できる。
 */
export function buildTypeAsEvalCode(selector: string, text: string): string {
  const selEscaped = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const textEscaped = text
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
  return `(async () => {
  try {
    const el = document.querySelector('${selEscaped}');
    if (!el) return { didAction: false, reason: 'selector not found' };
    const isContentEditable = el.isContentEditable === true || el.getAttribute('contenteditable') === 'true';
    if (isContentEditable) {
      el.focus();
      el.click();
      await new Promise(r => setTimeout(r, 100));
      const text = \`${textEscaped}\`;
      if (text.length > 0) {
        const ok = document.execCommand('insertText', false, text);
        if (!ok) {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('insertText', false, text);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 100));
      }
      return { didAction: true, reason: 'text entered (contenteditable)' };
    }
    if (el.type === 'password' || el.getAttribute('type') === 'password') {
      el.focus();
      el.click();
      await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < \`${textEscaped}\`.length; i++) {
        const char = \`${textEscaped}\`[i];
        el.value += char;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: String(char.charCodeAt(0)), bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 10));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      return { didAction: true, reason: 'text entered' };
    }
    el.value += \`${textEscaped}\`;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    return { didAction: true, reason: 'text entered' };
  } catch (e) {
    return { didAction: false, reason: String(e) };
  }
})()`;
}

/**
 * DOM セレクタにテキストを入力（eval で実装）
 * （既存の typeInContext の代わり）
 */
export async function typeInContext(
  contextId: string,
  selector: string,
  text: string,
  opts?: { clear?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const escapeText = text.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
  const clearCmd = opts?.clear
    ? `el.value = ''; el.dispatchEvent(new Event('change', { bubbles: true }));`
    : "";

  const code = `
    (async () => {
      try {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return { didAction: false, reason: 'selector not found' };
        
        // contenteditable（Xの投稿欄など）の場合は .value が使えない。focus 後に execCommand('insertText') で入力
        const isContentEditable = el.isContentEditable === true || el.getAttribute('contenteditable') === 'true';
        if (isContentEditable) {
          el.focus();
          el.click();
          await new Promise(r => setTimeout(r, 100));
          const text = \`${escapeText}\`;
          if (text.length > 0) {
            const ok = document.execCommand('insertText', false, text);
            if (!ok) {
              // フォールバック: 選択してから insertText（空でない場合のみ）
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              sel.removeAllRanges();
              sel.addRange(range);
              document.execCommand('insertText', false, text);
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 100));
          }
          return { didAction: true, reason: 'text entered (contenteditable)' };
        }
        
        // パスワード入力欄の場合は、focus()とclick()を呼び出してからキー入力をシミュレート
        const isPasswordField = el.type === 'password' || el.getAttribute('type') === 'password';
        
        if (isPasswordField) {
          // パスワード入力欄の場合: focus()とclick()を呼び出してからキー入力をシミュレート
          el.focus();
          el.click();
          await new Promise(r => setTimeout(r, 100));
          
          ${clearCmd ? "el.value = '';" : ""}
          
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
    error: didAction ? undefined : result.result?.reason || "action failed",
  };
}

/**
 * スクリーンショットを取得
 */
export async function captureScreenshot(
  contextId: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const result = await execInContainer(
    contextId,
    "eval",
    { eval: "({ screenshotRequested: true })" },
    { screenshot: true },
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
  trim: boolean = true,
): Promise<{ ok: boolean; html?: string; error?: string }> {
  const result = await execInContainer(
    contextId,
    "eval",
    { eval: "null" }, // 無害な式（空文字列は不可）
    { returnHtml: trim ? "trim" : true },
  );

  if (!result.ok) {
    logger.event(
      "browser.getPageHtml.error",
      {
        contextId,
        error: result.errorDetail?.message,
        resultBody: JSON.stringify(result.body || {}).substring(0, 200),
      },
      "error",
    );
    return {
      ok: false,
      error: result.errorDetail?.message || "HTML取得に失敗しました",
    };
  }

  // レスポンス構造を確認: body.html または直接 html の可能性がある
  const html = result.body?.html || (result as any).html;

  if (!html) {
    logger.event(
      "browser.getPageHtml.noHtml",
      {
        contextId,
        hasBody: !!result.body,
        bodyKeys: result.body ? Object.keys(result.body).join(",") : "none",
        resultKeys: Object.keys(result).join(","),
        resultBody: JSON.stringify(result.body || {}).substring(0, 200),
        fullResult: JSON.stringify(result).substring(0, 500),
      },
      "warn",
    );
    return {
      ok: false,
      error: "HTMLが取得できませんでした（レスポンスにhtmlが含まれていません）",
    };
  }

  logger.event(
    "browser.getPageHtml.success",
    {
      contextId,
      htmlLength: html.length,
    },
    "info",
  );

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
    const url = `${getContainerBrowserHost()}/health`;
    const response = await fetch(url, { method: "GET" });

    if (response.ok) {
      return {
        ok: true,
        url: getContainerBrowserHost(),
      };
    } else {
      return {
        ok: false,
        url: getContainerBrowserHost(),
        error: `HTTP ${response.status}`,
      };
    }
  } catch (e: any) {
    return {
      ok: false,
      url: getContainerBrowserHost(),
      error: String(e),
    };
  }
}

/**
 * Electron 原生レイヤーでのクッキー注入
 */
export async function setNativeCookies(
  contextId: string,
  cookies: any[],
  options?: ExecOptions,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const url = `${getContainerBrowserHost()}/internal/cookies/set_native`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contextId,
        cookies,
        options: {
          timeoutMs: options?.timeoutMs || 30000,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result: any = await response.json();
    return {
      ok: result.ok,
      message: result.message || result.error,
    };
  } catch (e: any) {
    return {
      ok: false,
      message: String(e),
    };
  }
}

/**
 * Arkose Captcha (FunCaptcha) の自動解除をトリガー
 */
export async function solveArkose(
  contextId: string,
  options?: ExecOptions,
): Promise<{ ok: boolean; message?: string }> {
  const result = await execInContainer(
    contextId,
    "solveCaptcha",
    {},
    { ...options, timeoutMs: options?.timeoutMs || 60000 },
  );
  return {
    ok: result.ok,
    message: result.body?.message || result.errorDetail?.message,
  };
}
