import fs from 'fs';
import path from 'path';

const file = 'c:\\Users\\Administrator\\AppData\\Local\\Programs\\Antigravity\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.js';

if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    const searchStrings = ["JavaScript execution policy", "terminalDeniedCommands", "Deny List"];
    for (const s of searchStrings) {
        const index = content.indexOf(s);
        if (index !== -1) {
            console.log(`--- FOUND "${s}" ---`);
            console.log(`CONTEXT: ${content.substring(index - 200, index + 800)}`);
        }
    }
}
