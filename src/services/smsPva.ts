import { loadSettings } from './appSettings.js';
import { logger } from '../utils/logger';

export interface SmsPvaNumberResponse {
    ok: boolean;
    orderId?: string;
    phoneNumber?: string;
    error?: string;
}

export interface SmsPvaCodeResponse {
    ok: boolean;
    code?: string;
    error?: string;
    status?: number;
}

/**
 * SMSPVA (Activation API V2) 連携サービス
 */
export class SmsPvaService {
    private base = 'https://api.smspva.com';
    private get apiKey() {
        return loadSettings().smsPvaApiKey;
    }

    /**
     * 電話番号を取得
     * @param countryCode 国コード (例: 'JP', 'RU', 'VN')
     * @param serviceCode サービスコード (Rolex用には汎用の 'opt20' など)
     */
    async getNumber(countryCode: string, serviceCode: string): Promise<SmsPvaNumberResponse> {
        if (!this.apiKey) {
            return { ok: false, error: 'SMSPVA API Key is not set in settings.json' };
        }

        try {
            const url = `${this.base}/activation/number/${countryCode}/${serviceCode}`;
            const resp = await fetch(url, {
                headers: { 'apikey': this.apiKey }
            });

            if (!resp.ok) {
                return { ok: false, error: `HTTP ${resp.status}` };
            }

            const data: any = await resp.json();
            if (data.status === 1 || data.orderId) {
                return {
                    ok: true,
                    orderId: String(data.orderId || data.id),
                    phoneNumber: data.phoneNumber || data.number
                };
            }

            return { ok: false, error: data.error || 'Failed to get number' };
        } catch (e: any) {
            logger.event('smsPva.getNumber.error', { err: String(e) }, 'error');
            return { ok: false, error: String(e) };
        }
    }

    /**
     * SMSコードを取得（ポーリング用内部メソッド）
     */
    async getSmsCode(orderId: string): Promise<SmsPvaCodeResponse> {
        if (!this.apiKey) return { ok: false, error: 'API Key missing' };

        try {
            const url = `${this.base}/activation/sms/${orderId}`;
            const resp = await fetch(url, {
                headers: { 'apikey': this.apiKey }
            });

            if (!resp.ok) {
                return { ok: false, error: `HTTP ${resp.status}`, status: resp.status };
            }

            const data: any = await resp.json();
            // status: 1 = success, status: 2 = waiting
            if (data.status === 1 && data.sms) {
                return { ok: true, code: data.sms };
            }

            return { ok: false, status: data.status, error: data.error || 'Waiting for SMS...' };
        } catch (e: any) {
            return { ok: false, error: String(e) };
        }
    }

    /**
     * コードが届くまで待機
     */
    async waitForCode(orderId: string, timeoutMs: number = 180000): Promise<string | null> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const result = await this.getSmsCode(orderId);
            if (result.ok && result.code) {
                return result.code;
            }

            // 数秒待機
            await new Promise(r => setTimeout(r, 5000));
        }
        return null;
    }
}

export const smsPvaService = new SmsPvaService();
