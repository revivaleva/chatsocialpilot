
import { evalInContext } from '../src/drivers/browser';

async function main() {
    const cid = '7be15478-3969-400d-b7be-d4d788885c10';
    const res = await evalInContext(cid, `(function(){
        const f = document.querySelector("iframe[src*='cloudflare']");
        if(!f) return { error: "iframe not found" };
        const r = f.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);
    console.log(JSON.stringify(res));
}
main().catch(console.error);
