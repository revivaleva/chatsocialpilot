import fs from 'fs';
import path from 'path';

const file = 'c:\\Users\\Administrator\\AppData\\Local\\Programs\\Antigravity\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.js';

if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    const pattern = '{isUssSetting:!0,label:"Auto Execution"';
    let index = content.indexOf(pattern);
    if (index !== -1) {
        console.log(`FOUND ${pattern}`);
        console.log(`CONTEXT: ${content.substring(index, index + 2000)}`);
    }
}
