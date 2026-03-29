import fs from 'fs';
import path from 'path';

const file = 'c:\\Users\\Administrator\\AppData\\Local\\Programs\\Antigravity\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.js';

if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf-8');
    const searchPatterns = [
        /(var|let|const)?\s*ik\s*;\s*\(function\s*\(t\)\{([\s\S]*?)\}\)\(ik\|\|\(ik=\{\}\)\)/,
        /(var|let|const)?\s*R2\s*;\s*\(function\s*\(t\)\{([\s\S]*?)\}\)\(R2\|\|\(R2=\{\}\)\)/
    ];

    for (const p of searchPatterns) {
        const match = content.match(p);
        if (match) {
            console.log(`FOUND ENUM: ${match[0].substring(0, 100)}...`);
            console.log(`VALUES: ${match[2]}`);
        }
    }
} else {
    console.log("File not found");
}
