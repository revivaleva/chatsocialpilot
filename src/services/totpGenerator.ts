/**
 * TOTP（Time-based One-Time Password）コード生成サービス
 * 
 * 認証アプリ（Google Authenticator等）で使用されるTOTPコードを生成します
 */

import { authenticator } from 'otplib';
import { logger } from '../utils/logger';

/**
 * TOTPコードを生成
 * 
 * @param secret TOTPシークレットキー（Base32形式）
 * @returns 6桁のTOTPコード（文字列）
 */
export function generateTOTPCode(secret: string): string {
  try {
    // シークレットキーが空でないことを確認
    if (!secret || typeof secret !== 'string' || secret.trim() === '') {
      logger.event('totp.generate.error', { 
        error: 'SECRET_EMPTY',
        message: 'TOTPシークレットキーが空です'
      }, 'warn');
      throw new Error('TOTPシークレットキーが指定されていません');
    }

    // シークレットキーをトリム
    const trimmedSecret = secret.trim();

    // TOTPコードを生成（デフォルトで6桁）
    const code = authenticator.generate(trimmedSecret);

    logger.event('totp.generate.success', { 
      codeLength: code.length,
      secretLength: trimmedSecret.length
    }, 'debug');

    return code;
  } catch (e: any) {
    const errorMessage = String(e?.message || e);
    logger.event('totp.generate.error', { 
      error: 'GENERATION_FAILED',
      message: errorMessage
    }, 'error');
    throw new Error(`TOTPコード生成に失敗しました: ${errorMessage}`);
  }
}

/**
 * TOTPコードの有効性を検証（オプション機能）
 * 
 * @param secret TOTPシークレットキー
 * @param code 検証するTOTPコード
 * @param window 許容する時間ウィンドウ（デフォルト: 1）
 * @returns 有効な場合true
 */
export function verifyTOTPCode(secret: string, code: string, window: number = 1): boolean {
  try {
    if (!secret || typeof secret !== 'string' || secret.trim() === '') {
      return false;
    }

    if (!code || typeof code !== 'string' || code.trim() === '') {
      return false;
    }

    // window オプションを設定（型定義の問題を回避）
    const originalWindow = authenticator.options.window;
    authenticator.options.window = window;
    
    let isValid: boolean;
    try {
      isValid = authenticator.verify({
        token: code.trim(),
        secret: secret.trim()
      });
    } finally {
      // 元の設定に戻す
      authenticator.options.window = originalWindow;
    }

    logger.event('totp.verify', { 
      isValid,
      codeLength: code.trim().length
    }, 'debug');

    return isValid;
  } catch (e: any) {
    logger.event('totp.verify.error', { 
      error: String(e?.message || e)
    }, 'warn');
    return false;
  }
}

