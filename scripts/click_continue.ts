
import { execInContainer } from '../src/drivers/browser';

async function main() {
    const cid = 'dd7f45b7-4b0f-481b-8ca1-41b56e2f3117';
    console.log("Clicking 'Continue to X'...");
    const res = await execInContainer(cid, 'eval', {
        eval: "(function() { const btn = document.querySelector('input[type=\"submit\"][value*=\"Continue\"], input[type=\"submit\"][value*=\"次へ\"], input[type=\"submit\"][value*=\"進む\"]') || Array.from(document.querySelectorAll('div[role=\"button\"], span, button, a')).find(el => { const t = (el.innerText || el.value || '').toLowerCase(); return t.includes('continue') || t.includes('次へ') || t.includes('進む'); }); if (btn) { btn.click(); return true; } return false; })()"
    });
    console.log(JSON.stringify(res));
}

main().catch(console.error);
