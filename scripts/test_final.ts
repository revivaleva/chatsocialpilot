
async function main() {
    const xid = 'SBneder-Test-All';
    const fpRes = await fetch('http://localhost:5050/fingerprints?limit=1&deviceType=desktop&os=windows&browser=chrome');
    const fps = await fpRes.json();
    const fp = fps[0];

    // Try both just in case
    const body = {
        fingerprintId: fp.id,
        name: xid,
        persistence: 'cloud',
        storage: 'cloud',
        proxy: {
            value: 'http',
            extra: {
                host: 'isp.decodo.com',
                port: 10049,
                id: 'sp5ck8c8t3',
                secret: 'Plz8mgjG15rvJ=x0wX'
            }
        },
        browser: {
            launcher: 'playwright'
        }
    };

    const res = await fetch('http://localhost:5050/profiles/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    const profile = await res.json();
    console.log('Result:', JSON.stringify(profile, null, 2));
}
main();
