import fs from 'fs';
import path from 'path';

const file = 'c:\\Users\\Administrator\\AppData\\Local\\Programs\\Antigravity\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.js';

if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    const pattern = 'topic:"uss-agentPreferences"';
    let index = content.indexOf(pattern);
    if (index !== -1) {
        console.log(`FOUND ${pattern}`);
        console.log(`CONTEXT: ${content.substring(index - 500, index + 500)}`);
    } else {
        // Try without quotes
        index = content.indexOf('topic:uss-agentPreferences');
        if (index !== -1) {
            console.log(`FOUND topic:uss-agentPreferences`);
            console.log(`CONTEXT: ${content.substring(index - 500, index + 500)}`);
        }
    }
}
