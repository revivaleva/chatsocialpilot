
import fetch from 'node-fetch';

async function checkJapanStock() {
    console.log('Japan (日本) の在庫状況を取得中...');
    try {
        const response = await fetch('https://5sim.net/v1/guest/products/japan/any', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            console.error('エラー:', await response.text());
            return;
        }

        const p = await response.json();
        const targets = ['other', 'google', 'facebook', 'microsoft', 'yahoo', 'line', 'mercari'];

        console.log('\n--- Japan Stock Status ---');
        targets.forEach(t => {
            if (p[t]) {
                console.log(`${t.padEnd(12)}: Price ${String(p[t].Price).padEnd(8)} RUB, Qty ${p[t].Qty}`);
            } else {
                console.log(`${t.padEnd(12)}: No Stock`);
            }
        });
        console.log('--------------------------');

    } catch (err) {
        console.error('実行エラー:', err);
    }
}

checkJapanStock();
