import fs from 'fs';
import path from 'path';

const file = 'c:\\Users\\Administrator\\AppData\\Local\\Programs\\Antigravity\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.js';

if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    const pattern = "Always Proceed";
    let index = -1;
    let count = 0;
    while ((index = content.indexOf(pattern, index + 1)) !== -1 && count < 5) {
        console.log(`--- MATCH ${++count} ---`);
        console.log(`CONTEXT: ${content.substring(index - 300, index + 300)}`);
    }
} else {
    console.log("File not found");
}
