import fs from 'fs';
import path from 'path';

const file = 'c:\\Users\\Administrator\\AppData\\Local\\Programs\\Antigravity\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.js';

if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    const pattern = 'const tB={'; // Adjust based on previous context
    let index = content.indexOf('TERMINAL_AUTO_EXECUTION_POLICY:"cached.terminalAutoExecutionPolicy"');
    if (index !== -1) {
        // Find the start of the object
        const start = content.lastIndexOf('{', index);
        const end = content.indexOf('}', index);
        console.log(`FOUND SENTINEL OBJECT`);
        console.log(`CONTENT: ${content.substring(start, end + 1)}`);
    }
}
