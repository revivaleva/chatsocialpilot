async function test() {
    try {
        const resp = await fetch('http://127.0.0.1:3001/internal/containers/active');
        const data = await resp.json();
        console.log('API Response:', JSON.stringify(data, null, 2));
    } catch (e: any) {
        console.error('API Error:', e.message);
    }
}

test();
