
import { evalInContext } from '../src/drivers/browser';

async function main() {
    const cid = 'e4add661-ce4b-4077-88c1-fdf5a881c83a';
    const res = await evalInContext(cid, `(function(){
        const all = Array.from(document.querySelectorAll("*")).map(el => ({
            tag: el.tagName,
            text: el.innerText,
            role: el.getAttribute("role"),
            className: el.className
        })).filter(el => (el.text || "").includes("Send email"));
        return all;
    })()`);
    console.log(JSON.stringify(res));
}
main().catch(console.error);
