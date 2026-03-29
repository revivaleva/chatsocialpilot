
import { evalInContext } from '../src/drivers/browser';

async function main() {
    const cid = 'fcfaba63-b3d2-4571-98aa-14288257c96c';
    const res = await evalInContext(cid, `(function(){
        function traverse(root, list = []) {
            const all = root.querySelectorAll("*");
            all.forEach(el => {
                if (el.shadowRoot) {
                    list.push({ tagName: el.tagName, id: el.id, className: el.className });
                    traverse(el.shadowRoot, list);
                }
            });
            return list;
        }
        return traverse(document);
    })()`);
    console.log(JSON.stringify(res));
}
main().catch(console.error);
