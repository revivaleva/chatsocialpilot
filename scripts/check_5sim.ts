import dotenv from 'dotenv';
dotenv.config();

const FIVESIM_API_KEY = process.env.FIVESIM_API_KEY;

async function fivesimRequest(path: string) {
    const url = `https://5sim.net/v1${path}`;
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${FIVESIM_API_KEY}`,
            'Accept': 'application/json'
        }
    });
    const text = await res.text();
    return { status: res.status, text };
}

async function main() {
    console.log('Requesting Japan / Google...');
    const res = await fivesimRequest('/user/buy/activation/japan/any/google');
    console.log('Result:', res);
}

main().catch(console.error);
