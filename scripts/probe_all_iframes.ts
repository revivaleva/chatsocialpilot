
import { evalInContext } from '../src/drivers/browser';

async function main() {
    const cid = '7be15478-3969-400d-b7be-d4d788885c10';
    const res = await evalInContext(cid, `(function(){
        const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
            src: f.src,
            id: f.id,
            className: f.className,
            rect: f.getBoundingClientRect()
        }));
        return { count: iframes.length, iframes };
    })()`);
    console.log(JSON.stringify(res));
}
main().catch(console.error);
