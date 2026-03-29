import fs from 'fs';
import path from 'path';

const file = 'c:\\Users\\Administrator\\AppData\\Local\\Programs\\Antigravity\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.js';

if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    const index = content.indexOf('reviewPolicy');
    if (index !== -1) {
        console.log("FOUND reviewPolicy");
        console.log(`CONTEXT: ${content.substring(index - 200, index + 500)}`);
    } else {
        console.log("NOT FOUND in content");
    }

    const index2 = content.indexOf('autoExecution');
    if (index2 !== -1) {
        console.log("FOUND autoExecution");
        console.log(`CONTEXT: ${content.substring(index2 - 200, index2 + 500)}`);
    }

    const index3 = content.indexOf('javascriptExecutionPolicy');
    if (index3 !== -1) {
        console.log("FOUND javascriptExecutionPolicy");
        console.log(`CONTEXT: ${content.substring(index3 - 200, index3 + 500)}`);
    }
} else {
    console.log("File not found");
}
