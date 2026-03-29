import dotenv from 'dotenv';
dotenv.config();

const CB_API_BASE = 'http://127.0.0.1:3002/internal';

async function cbRequest(path: string, method: string = 'GET', body?: any) {
    const url = `${CB_API_BASE}${path}`;
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
}

async function main() {
    const list = await cbRequest('/containers');
    const container = list.containers.find((c: any) => c.name.startsWith('rolex-manual-captcha'));
    if (!container) {
        console.log('Target container not found.');
        return;
    }

    const cid = container.id;
    console.log(`Analyzing container ${cid}...`);

    const result = await cbRequest('/exec', 'POST', {
        contextId: cid,
        command: 'eval',
        eval: `(() => {
            const ccInput = document.querySelector('[name="phone_country_code"]');
            const currentCC = ccInput ? ccInput.value : 'null';
            
            // Try to set to 31 (Netherlands)
            if (ccInput) {
                ccInput.value = '31';
                ccInput.dispatchEvent(new Event('input', { bubbles: true }));
                ccInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
            
            // Try to find intl-tel-input instance and set country
            let itiSet = false;
            try {
                const telInput = document.querySelector('#phone_number');
                // Common ways to access iti
                const iti = window.intlTelInputGlobals?.getInstance(telInput);
                if (iti) {
                    iti.setCountry('nl');
                    itiSet = true;
                }
            } catch(e) {}

            return {
                before: currentCC,
                after: ccInput ? ccInput.value : 'null',
                itiSet: itiSet
            };
        })()`
    });

    console.log('Result:', JSON.stringify(result.result, null, 2));
}

main().catch(err => console.error(err));
