/**
 * メール取得サービス（IMAPを使用した一般的な実装）
 * 
 * 一般的なメールサーバー（Gmail、Outlook、FirstMailなど）のIMAP接続をサポート
 */

import { createRequire } from 'module';
import { logger } from '../utils/logger';

const require = createRequire(import.meta.url);

export type EmailFetchOptions = {
  email: string;
  email_password: string;
  subject_pattern?: string;  // 正規表現パターン（例: "X.*verification|確認コード"）
  code_pattern?: string;    // 確認コードの正規表現パターン（例: "\\d{6}"）
  timeout_seconds?: number; // タイムアウト（秒）
  from_pattern?: string;    // 送信者パターン（例: "noreply@x.com"）
  imap_host?: string;       // IMAPサーバーホスト（省略時は自動検出）
  imap_port?: number;       // IMAPサーバーポート（省略時は993）
};

export type EmailFetchResult = {
  ok: boolean;
  code?: string;
  error?: string;
  message?: string;
};

/**
 * メールアドレスからIMAPサーバー設定を自動検出
 */
function detectImapConfig(email: string): { host: string; port: number } {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  
  // 一般的なメールプロバイダーの設定
  if (domain.includes('gmail.com')) {
    return { host: 'imap.gmail.com', port: 993 };
  } else if (domain.includes('outlook.com') || domain.includes('hotmail.com') || domain.includes('live.com')) {
    return { host: 'outlook.office365.com', port: 993 };
  } else if (domain.includes('yahoo.com') || domain.includes('yahoo.co.jp')) {
    return { host: 'imap.mail.yahoo.com', port: 993 };
  } else if (domain.includes('1st-mail.jp') || domain.includes('firstmail') || domain.includes('estabamail.com')) {
    // FirstMail公式設定: imap.firstmail.ltd (SSL: ポート 993)
    // FirstMailは複数のドメイン（1st-mail.jp、estabamail.comなど）を提供しているが、
    // すべて同じIMAPサーバー（imap.firstmail.ltd）を使用
    return { host: 'imap.firstmail.ltd', port: 993 };
  }
  
  // デフォルト: ドメイン名から推測
  // 一般的なパターン: mail.{domain}, imap.{domain}
  return { host: `mail.${domain}`, port: 993 };
}

/**
 * IMAPを使用してメールから確認コードを取得
 */
export async function fetchVerificationCode(options: EmailFetchOptions): Promise<EmailFetchResult> {
  const {
    email,
    email_password,
    subject_pattern = 'verification|確認コード|code',
    code_pattern = '\\d{6}',
    timeout_seconds = 60,
    from_pattern,
    imap_host,
    imap_port
  } = options;

  logger.event('email.fetch.start', { 
    email, 
    emailPreview: email ? (email.split('@')[0] + '@***') : undefined,
    passwordLength: email_password ? email_password.length : 0,
    timeout_seconds, 
    code_pattern, 
    note: '件名フィルタなし、UNSEEN条件なし、最新1件取得' 
  }, 'info');

  const startTime = Date.now();
  const timeoutMs = timeout_seconds * 1000;
  // 件名パターンでフィルタリング（指定されている場合）
  const subjectRegex = subject_pattern ? new RegExp(subject_pattern, 'i') : null;
  const codeRegex = new RegExp(code_pattern);

  // IMAP設定: FirstMail固定（imap.firstmail.ltd:993）
  // メールアドレスのドメインに関係なく、FirstMailのIMAPサーバーを使用
  const imapConfig = { host: 'imap.firstmail.ltd', port: 993 };
  logger.event('email.fetch.imap_config', { host: imapConfig.host, port: imapConfig.port }, 'debug');

  try {
    // imapパッケージを使用（CommonJS形式なのでrequireを使用）
    let Imap: any;
    try {
      // CommonJS形式のパッケージなので、createRequireでrequireを使用
      Imap = require('imap');
    } catch (importErr: any) {
      // imapパッケージがインストールされていない場合
      logger.event('email.fetch.imap_not_installed', { error: String(importErr?.message || importErr) }, 'warn');
      
      return {
        ok: false,
        error: 'IMAP_NOT_AVAILABLE',
        message: `IMAPパッケージがインストールされていません。npm install imap を実行してください。`
      };
    }

    return new Promise<EmailFetchResult>((resolve) => {
      const imap = new Imap({
        user: email,
        password: email_password,
        host: imapConfig.host,
        port: imapConfig.port,
        tls: true,
        tlsOptions: { rejectUnauthorized: false } // 自己署名証明書を許可（必要に応じて調整）
      });

      const resolved = { current: false };
      let connectionState = 'not_started'; // not_started, connecting, ready, inbox_opened, searching, fetching

      // タイムアウト処理
      const timeoutId = setTimeout(() => {
        if (!resolved.current) {
          resolved.current = true;
          const elapsed = Date.now() - startTime;
          logger.event('email.fetch.timeout', { 
            email, 
            elapsed_seconds: Math.round(elapsed / 1000),
            connection_state: connectionState,
            timeout_seconds: timeout_seconds
          }, 'warn');
          try { imap.end(); } catch {}
          resolve({
            ok: false,
            error: 'TIMEOUT',
            message: `メール取得がタイムアウトしました（${timeout_seconds}秒）。接続状態: ${connectionState}`
          });
        }
      }, timeoutMs);

      imap.once('error', (err: Error) => {
        if (!resolved.current) {
          resolved.current = true;
          clearTimeout(timeoutId);
          const errorMsg = String(err?.message || err);
          const elapsed = Date.now() - startTime;
          logger.event('email.fetch.imap_error', { 
            email, 
            host: imapConfig.host, 
            port: imapConfig.port, 
            error: errorMsg,
            connection_state: connectionState,
            elapsed_seconds: Math.round(elapsed / 1000),
            error_code: err.name || 'UNKNOWN',
            error_stack: err.stack?.substring(0, 200) // 最初の200文字のみ
          }, 'warn');
          
          // DNS解決エラーの場合の案内
          let suggestion = '';
          if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('getaddrinfo')) {
            suggestion = 'FirstMailのIMAPサーバー (imap.firstmail.ltd) に接続できません。ネットワーク接続またはDNS設定を確認してください。';
          } else if (errorMsg.includes('ECONNREFUSED')) {
            suggestion = '接続が拒否されました。ポート993が開いているか、ファイアウォール設定を確認してください。';
          } else if (errorMsg.includes('ETIMEDOUT')) {
            suggestion = '接続タイムアウト。ネットワーク接続またはサーバーの応答を確認してください。';
          }
          
          resolve({
            ok: false,
            error: 'IMAP_ERROR',
            message: `IMAP接続エラー: ${errorMsg}${suggestion ? ' ' + suggestion : ''}`
          });
        }
      });

      imap.once('end', () => {
        const elapsed = Date.now() - startTime;
        logger.event('email.fetch.imap_end', { email, elapsed_seconds: Math.round(elapsed / 1000), connection_state: connectionState }, 'info');
      });

      logger.event('email.fetch.imap_connecting', { email, host: imapConfig.host, port: imapConfig.port }, 'info');
      connectionState = 'connecting';
      imap.once('ready', () => {
          const elapsed = Date.now() - startTime;
          connectionState = 'ready';
          logger.event('email.fetch.imap_ready', { 
            email, 
            host: imapConfig.host, 
            elapsed_seconds: Math.round(elapsed / 1000) 
          }, 'info');
          logger.event('email.fetch.openbox_start', { email }, 'info');
          imap.openBox('INBOX', false, (err: Error | null, box: any) => {
            if (err) {
              if (!resolved.current) {
                resolved.current = true;
                clearTimeout(timeoutId);
                const elapsed = Date.now() - startTime;
                logger.event('email.fetch.openbox_error', { 
                  email, 
                  error: String(err?.message || err),
                  elapsed_seconds: Math.round(elapsed / 1000)
                }, 'warn');
                resolve({
                  ok: false,
                  error: 'OPEN_BOX_ERROR',
                  message: `メールボックスを開けませんでした: ${String(err?.message || err)}`
                });
              }
              return;
            }
            connectionState = 'inbox_opened';
            const elapsed = Date.now() - startTime;
            logger.event('email.fetch.inbox_opened', { 
              email, 
              elapsed_seconds: Math.round(elapsed / 1000),
              box_messages: box?.messages?.total || 'unknown',
              box_unseen: box?.messages?.new || 'unknown'
            }, 'info');

          // 検索条件を構築（UNSEENを外し、最新1件を取得）
          const searchCriteria: any[] = ['ALL']; // 全メールから最新を取得
          if (from_pattern) {
            searchCriteria.push(['FROM', from_pattern]);
          }

            connectionState = 'searching';
            const searchElapsed = Date.now() - startTime;
            logger.event('email.fetch.search_start', { 
              email, 
              criteria: JSON.stringify(searchCriteria),
              note: 'UNSEEN条件を外し、最新1件を取得',
              elapsed_seconds: Math.round(searchElapsed / 1000)
            }, 'info');
            imap.search(searchCriteria, (searchErr: Error | null, results: number[]) => {
              if (searchErr) {
                if (!resolved.current) {
                  resolved.current = true;
                  clearTimeout(timeoutId);
                  try { imap.end(); } catch {}
                  logger.event('email.fetch.search_error', { email, error: String(searchErr?.message || searchErr) }, 'warn');
                  resolve({
                    ok: false,
                    error: 'SEARCH_ERROR',
                    message: `メール検索エラー: ${String(searchErr?.message || searchErr)}`
                  });
                }
                return;
              }

              const searchResultElapsed = Date.now() - startTime;
              logger.event('email.fetch.search_result', { 
                email, 
                count: results?.length || 0,
                elapsed_seconds: Math.round(searchResultElapsed / 1000),
                uids: results?.slice(-5) || [] // 最後の5件のUIDをログに記録（最新のUIDを含む）
              }, 'info');
              if (!results || results.length === 0) {
                // メールが1件もない場合
                logger.event('email.fetch.no_email_found', { 
                  email, 
                  elapsed_seconds: Math.round(searchResultElapsed / 1000)
                }, 'warn');
                if (!resolved.current) {
                  resolved.current = true;
                  clearTimeout(timeoutId);
                  try { imap.end(); } catch {}
                  resolve({
                    ok: false,
                    error: 'NO_EMAIL_FOUND',
                    message: `メールボックスにメールがありません`
                  });
                }
                return;
            }

            // 直近1件のみ取得（最新のUID = 配列の最後の要素）
            const latestUid = results[results.length - 1];
            const processingElapsed = Date.now() - startTime;
            connectionState = 'fetching';
            logger.event('email.fetch.processing_emails', { 
              email, 
              totalCount: results.length, 
              latestUid,
              elapsed_seconds: Math.round(processingElapsed / 1000)
            }, 'info');
            fetchAndParseEmails(imap, [latestUid], codeRegex, resolve, timeoutId, resolved, startTime, subjectRegex);
          });
        });
      });

      logger.event('email.fetch.imap_connect_called', { email, host: imapConfig.host, port: imapConfig.port }, 'info');
      try {
        imap.connect();
        logger.event('email.fetch.imap_connect_initiated', { email }, 'info');
      } catch (connectErr: any) {
        logger.event('email.fetch.imap_connect_exception', { 
          email, 
          error: String(connectErr?.message || connectErr) 
        }, 'error');
        if (!resolved.current) {
          resolved.current = true;
          clearTimeout(timeoutId);
          resolve({
            ok: false,
            error: 'IMAP_CONNECT_EXCEPTION',
            message: `IMAP接続の開始に失敗しました: ${String(connectErr?.message || connectErr)}`
          });
        }
      }
    });

  } catch (e: any) {
    logger.event('email.fetch.error', { email, error: String(e?.message || e) }, 'warn');
    return {
      ok: false,
      error: 'FETCH_ERROR',
      message: `メール取得中にエラーが発生しました: ${String(e?.message || e)}`
    };
  }
}

/**
 * メールを取得して確認コードを抽出
 * 件名フィルタは外し、直近1件のメールからコードを抽出
 */
function fetchAndParseEmails(
  imap: any,
  uids: number[],
  codeRegex: RegExp,
  resolve: (result: EmailFetchResult) => void,
  timeoutId: NodeJS.Timeout,
  resolved: { current: boolean },
  startTime: number,
  subjectRegex?: RegExp | null
): void {
  const fetchStartTime = Date.now();
  logger.event('email.fetch.fetch_start', { 
    uids, 
    elapsed_seconds: Math.round((fetchStartTime - startTime) / 1000)
  }, 'info');
  
  const fetch = imap.fetch(uids, { bodies: '' });
  let foundCode: string | null = null;
  let messageCount = 0;
  let bodyLength = 0;

  fetch.on('message', (msg: any) => {
    messageCount++;
    let body = '';
    let subject = '';

    msg.once('attributes', (attrs: any) => {
      // attributesから件名を取得（空の場合もある）
      subject = attrs.subject || '';
      logger.event('email.fetch.message_attributes', { 
        uid: attrs.uid,
        subject_from_attrs: subject.substring(0, 200),
        date: attrs.date?.toISOString() || 'unknown'
      }, 'info');
    });

    msg.on('body', (stream: NodeJS.ReadableStream) => {
      stream.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
        bodyLength += chunk.length;
      });
    });

    msg.once('end', () => {
      const messageElapsed = Date.now() - startTime;
      logger.event('email.fetch.message_end', { 
        message_count: messageCount,
        body_length: bodyLength,
        elapsed_seconds: Math.round(messageElapsed / 1000)
      }, 'info');
      
      // メール本文の全文をログに出力（長い場合は適切に処理）
      // 最大50000文字まで出力（それ以上は切り詰め）
      const bodyForLog = bodyLength > 50000 ? body.substring(0, 50000) + '...(truncated)' : body;
      logger.event('email.fetch.message_body_full', { 
        body: bodyForLog,
        body_length: bodyLength,
        body_truncated: bodyLength > 50000
      }, 'info');
      
      // 件名をメールヘッダーから抽出（attributesから取得できなかった場合）
      if (!subject || subject.trim() === '') {
        // メールヘッダーから件名を抽出
        // Subject: 708170 is your X verification code の形式
        const subjectMatch = body.match(/^Subject:\s*(.+?)(?:\r?\n|$)/im);
        if (subjectMatch && subjectMatch[1]) {
          subject = subjectMatch[1].trim();
          logger.event('email.fetch.subject_extracted_from_header', { 
            subject: subject
          }, 'info');
        }
      }
      
      // RFC 2047形式のエンコードされた件名をデコード（=?UTF-8?B?...?= 形式）
      if (subject && subject.includes('=?') && subject.includes('?=')) {
        try {
          // Base64エンコードされた部分をデコード
          const decodedParts: string[] = [];
          let remaining = subject;
          
          while (remaining.length > 0) {
            const match = remaining.match(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/);
            if (match) {
              const charset = match[1];
              const encoding = match[2];
              const encodedText = match[3];
              
              if (encoding === 'B') {
                // Base64デコード
                const decoded = Buffer.from(encodedText, 'base64').toString(charset === 'UTF-8' ? 'utf8' : 'latin1');
                decodedParts.push(decoded);
              } else if (encoding === 'Q') {
                // Quoted-Printableデコード（簡易版）
                const decoded = encodedText.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_, hex) => {
                  return String.fromCharCode(parseInt(hex, 16));
                });
                decodedParts.push(decoded);
              }
              
              remaining = remaining.substring(match[0].length);
            } else {
              // エンコードされていない部分をそのまま追加
              const nextMatch = remaining.indexOf('=?');
              if (nextMatch >= 0) {
                decodedParts.push(remaining.substring(0, nextMatch));
                remaining = remaining.substring(nextMatch);
              } else {
                decodedParts.push(remaining);
                remaining = '';
              }
            }
          }
          
          const decodedSubject = decodedParts.join('');
          if (decodedSubject !== subject) {
            logger.event('email.fetch.subject_decoded', { 
              original: subject,
              decoded: decodedSubject
            }, 'info');
            subject = decodedSubject;
          }
        } catch (decodeErr: any) {
          logger.event('email.fetch.subject_decode_error', { 
            subject: subject.substring(0, 200),
            error: String(decodeErr?.message || decodeErr)
          }, 'warn');
        }
      }
      
      // 件名が取得できているか確認
      if (!subject || subject.trim() === '') {
        logger.event('email.fetch.subject_not_found', { 
          body_preview: body.substring(0, 500)
        }, 'warn');
        return; // 件名がない場合はスキップ
      }
      
      // 取得したメールの件名をログに出力
      logger.event('email.fetch.subject_received', { 
        subject: subject,
        subject_length: subject.length
      }, 'info');
      
      // 件名パターンでフィルタリング（必須）
      if (subjectRegex) {
        const subjectMatches = subjectRegex.test(subject);
        if (!subjectMatches) {
          logger.event('email.fetch.subject_not_matching_pattern', { 
            subject: subject,
            pattern: subjectRegex.toString()
          }, 'warn');
          return; // 件名パターンに一致しない場合はスキップ
        }
        logger.event('email.fetch.subject_matches_pattern', { 
          subject: subject,
          pattern: subjectRegex.toString()
        }, 'info');
      }
      
      // 件名から確認コードを抽出（例: "708170 is your X verification code" または "Xの認証コードは101861です"）
      const subjectCodeMatch = subject.match(codeRegex);
      if (subjectCodeMatch && subjectCodeMatch[0]) {
        foundCode = subjectCodeMatch[0];
        logger.event('email.fetch.code_found_in_subject', { 
          code: foundCode,
          subject: subject.substring(0, 200)
        }, 'info');
      } else {
        logger.event('email.fetch.code_not_found_in_subject', { 
          subject: subject.substring(0, 200),
          code_pattern: codeRegex.toString()
        }, 'warn');
      }
    });
  });

  fetch.once('end', () => {
    const fetchEndElapsed = Date.now() - startTime;
    const fetchDuration = Date.now() - fetchStartTime;
    if (!resolved.current && foundCode) {
      resolved.current = true;
      clearTimeout(timeoutId);
      try { imap.end(); } catch {}
      logger.event('email.fetch.success', { 
        codeLength: foundCode.length,
        code: foundCode,
        message_count: messageCount,
        body_length: bodyLength,
        fetch_duration_ms: fetchDuration,
        elapsed_seconds: Math.round(fetchEndElapsed / 1000)
      }, 'info');
      resolve({
        ok: true,
        code: foundCode,
        message: '確認コードを取得しました'
      });
    } else if (!resolved.current) {
      resolved.current = true;
      clearTimeout(timeoutId);
      try { imap.end(); } catch {}
      logger.event('email.fetch.code_not_found', { 
        message_count: messageCount,
        body_length: bodyLength,
        fetch_duration_ms: fetchDuration,
        elapsed_seconds: Math.round(fetchEndElapsed / 1000),
        code_pattern: codeRegex.toString(),
        subject_pattern: subjectRegex ? subjectRegex.toString() : '(none)'
      }, 'warn');
      resolve({
        ok: false,
        error: 'CODE_NOT_FOUND',
        message: 'メールから確認コードを抽出できませんでした'
      });
    }
  });

  fetch.once('error', (err: Error) => {
    if (!resolved.current) {
      resolved.current = true;
      clearTimeout(timeoutId);
      const fetchErrorElapsed = Date.now() - startTime;
      logger.event('email.fetch.fetch_error', { 
        error: String(err?.message || err),
        error_code: err.name || 'UNKNOWN',
        message_count: messageCount,
        elapsed_seconds: Math.round(fetchErrorElapsed / 1000)
      }, 'warn');
      try { imap.end(); } catch {}
      resolve({
        ok: false,
        error: 'FETCH_MESSAGE_ERROR',
        message: `メール取得エラー: ${String(err?.message || err)}`
      });
    }
  });
}

