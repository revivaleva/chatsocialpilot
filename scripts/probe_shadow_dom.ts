
import { evalInContext } from '../src/drivers/browser';

async function main() {
    const cid = '7be15478-3969-400d-b7be-d4d788885c10';
    const res = await evalInContext(cid, `(function(){
        const all = document.querySelectorAll("*");
        const shadows = [];
        all.forEach(el => {
            if (el.shadowRoot) {
                shadows.push({
                    tagName: el.tagName,
                    id: el.id,
                    html: el.shadowRoot.innerHTML
                });
            }
        });
        return { count: shadows.length, shadows };
    })()`);
    console.log(JSON.stringify(res));
}
main().catch(console.error);
