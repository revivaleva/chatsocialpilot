import fs from 'fs';
import path from 'path';
import os from 'os';

const searchPaths = [
    path.join(os.homedir(), '.gemini', 'antigravity', 'settings.json'),
    path.join(os.homedir(), '.antigravity', 'settings.json'),
    path.join(process.env.APPDATA || '', 'Code', 'User', 'settings.json'),
    path.join(process.cwd(), '.vscode', 'settings.json')
];

console.log("Searching for Antigravity settings files...");

for (const p of searchPaths) {
    if (fs.existsSync(p)) {
        console.log(`FOUND: ${p}`);
        try {
            const content = fs.readFileSync(p, 'utf-8');
            const json = JSON.parse(content);
            console.log(`CONTENT_PREVIEW: ${JSON.stringify(json, null, 2).substring(0, 500)}...`);

            // Look for specific keys
            const keys = Object.keys(json);
            const antiKeys = keys.filter(k => k.toLowerCase().includes('antigravity') || k.toLowerCase().includes('review') || k.toLowerCase().includes('terminal') || k.toLowerCase().includes('js') || k.toLowerCase().includes('execution'));
            if (antiKeys.length > 0) {
                console.log(`POTENTIAL_KEYS in ${p}: ${antiKeys.join(', ')}`);
            }
        } catch (e) {
            console.log(`ERROR reading ${p}: ${e}`);
        }
    } else {
        console.log(`NOT_FOUND: ${p}`);
    }
}

// Also check for environment variables
console.log("Checking relevant environment variables...");
for (const key in process.env) {
    if (key.toLowerCase().includes('antigravity') || key.toLowerCase().includes('gemini')) {
        console.log(`${key}: ${process.env[key]}`);
    }
}
