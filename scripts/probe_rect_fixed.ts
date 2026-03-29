
import { evalInContext } from '../src/drivers/browser';

async function main() {
    const cid = '7be15478-3969-400d-b7be-d4d788885c10';
    const res = await evalInContext(cid, `(function(){
        const el = document.querySelector("#AOzYg6");
        if(!el) return { error: "wrapper #AOzYg6 not found" };
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);
    console.log(JSON.stringify(res));
}
main().catch(console.error);
