
import { evalInContext } from '../src/drivers/browser';

async function main() {
    const cid = 'e4add661-ce4b-4077-88c1-fdf5a881c83a';
    const res = await evalInContext(cid, `(function(){
        const inputs = Array.from(document.querySelectorAll("input, button, a")).map(el => ({
            tag: el.tagName,
            type: el.type,
            value: el.value,
            text: el.innerText,
            aria: el.ariaLabel,
            id: el.id,
            className: el.className
        }));
        return inputs;
    })()`);
    console.log(JSON.stringify(res));
}
main().catch(console.error);
