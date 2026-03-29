
import { evalInContext } from '../src/drivers/browser';

async function main() {
    const cid = 'e4add661-ce4b-4077-88c1-fdf5a881c83a';
    const res = await evalInContext(cid, `(function(){
        const all = Array.from(document.querySelectorAll("*")).map(el => ({
            tag: el.tagName,
            text: el.innerText,
            aria: el.ariaLabel,
            role: el.getAttribute("role")
        })).filter(el => el.role === "button" || (el.text && el.text.length > 0));
        return all.slice(0, 20); // First 20 interesting elements
    })()`);
    console.log(JSON.stringify(res));
}
main().catch(console.error);
