
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

/**
 * 5sim 一連の流れデモスクリプト
 * 
 * 1. 番号を購入 (購入成功時のみ課金対象の候補)
 * 2. SMSが届くまでポーリング (一定時間)
 * 3. タイムアウトまたは取得成功で終了
 * 
 * ※ このスクリプトは実際に購入を試みるため、残高が消費される可能性があります。
 * ※ (SMSが届かなければ課金されません)
 */

const COUNTRY = 'japan';
const PRODUCT = 'other';
const OPERATOR = 'any';

async function demo5simFlow() {
    const apiKey = process.env.FIVESIM_API_KEY;
    if (!apiKey) {
        console.error('FIVESIM_API_KEY が設定されていません。');
        return;
    }

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
    };

    const buyUrl = `https://5sim.net/v1/user/buy/activation/${COUNTRY}/${OPERATOR}/${PRODUCT}`;

    let buyData = null;
    const MAX_BUY_ATTEMPTS = 5;

    for (let attempt = 1; attempt <= MAX_BUY_ATTEMPTS; attempt++) {
        console.log(`[${attempt}/${MAX_BUY_ATTEMPTS}] 番号の購入を試行中...`);
        const buyRes = await fetch(buyUrl, { headers });
        const text = await buyRes.text();

        try {
            buyData = JSON.parse(text);
            if (buyData.id) break; // 成功
        } catch (e) {
            // JSONパースエラーの場合、textの内容を直接チェック
            if (text === 'no free phones') {
                console.log('  -> 在庫なし (no free phones)');
            } else if (text === 'bad country') {
                console.log('  -> 不正な国名 (bad country)');
                // 不正な国名の場合は再試行しても無駄なので、ここでループを抜ける
                buyData = null; // buyDataをnullに設定して、ループ後のエラーハンドリングに任せる
                break;
            } else {
                console.log('  -> 通信エラーまたは予期せぬレスポンス:', text);
            }
        }

        if (attempt < MAX_BUY_ATTEMPTS) {
            console.log('  -> 5秒後に再試行します...');
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    if (!buyData || !buyData.id) {
        console.error('\n購入に失敗しました。現在、日本の番号は在庫が非常に不安定な可能性があります。');
        return;
    }

    console.log(`[1] 番号を購入中... (Country: ${COUNTRY}, Product: ${PRODUCT})`);

    try {
        const orderId = buyData.id;
        const phone = buyData.phone;
        console.log(`[成功] 番号取得: ${phone} (Order ID: ${orderId})`);
        console.log(`[2] SMSの待機を開始します (最大2分間ポーリング)...`);

        // 最大2分間、5秒おきにチェック
        for (let i = 0; i < 24; i++) {
            process.stdout.write('.');
            const checkRes = await fetch(`https://5sim.net/v1/user/check/${orderId}`, { headers });
            const checkData = await checkRes.json();

            if (checkData.sms && checkData.sms.length > 0) {
                console.log('\n\n--- SMSを受信しました！ ---');
                console.log('内容:', checkData.sms[0].text);
                console.log('コード:', checkData.sms[0].code);

                // 完了通知 (任意)
                await fetch(`https://5sim.net/v1/user/finish/${orderId}`, { headers });
                console.log('注文を完了としてマークしました。');
                return;
            }

            if (checkData.status === 'CANCELED' || checkData.status === 'TIMEOUT') {
                console.log(`\n注文が終了しました (${checkData.status})`);
                return;
            }

            await new Promise(r => setTimeout(r, 5000));
        }

        console.log('\n\n[タイムアウト] SMSが届きませんでした。キャンセルします...');
        await fetch(`https://5sim.net/v1/user/cancel/${orderId}`, { headers });
        console.log('注文をキャンセルしました。');

    } catch (error) {
        console.error('実行エラー:', error);
    }
}

demo5simFlow();
