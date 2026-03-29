
import { createContainer } from '../src/drivers/browser.js';
import { initDb } from '../src/drivers/db.js';

async function main() {
    initDb();
    const xid = 'SBneder60540';
    const proxyStr = 'isp.decodo.com:10049:sp5ck8c8t3:Plz8mgjG15rvJ=x0wX';
    const parts = proxyStr.split(':');

    const proxy = {
        server: `http://${parts[0]}:${parts[1]}`, // http or socks5
        username: parts[2],
        password: parts[3]
    };

    console.log(`Creating container/profile for ${xid} with proxy:`, proxy.server);

    // createContainer will:
    // 1. Send POST to /internal/containers/create
    // 2. exportServer.ts will create a Container record
    // 3. openContainerWindow will call KameleoApi.createProfile with persistence: 'cloud'
    const res = await createContainer({
        name: xid,
        proxy: proxy
    });

    console.log('Result:', JSON.stringify(res, null, 2));
}

main().catch(console.error);
