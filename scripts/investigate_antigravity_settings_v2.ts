import fs from 'fs';
import path from 'path';
import os from 'os';

const searchDirs = [
    path.join(os.homedir(), '.gemini'),
    path.join(os.homedir(), '.antigravity'),
    path.join(process.env.APPDATA || '', 'Antigravity'),
    path.join(process.env.LOCALAPPDATA || '', 'Antigravity'),
    path.join(process.env.APPDATA || '', 'Gemini'),
    path.join(process.env.LOCALAPPDATA || '', 'Gemini'),
    process.cwd()
];

console.log("Searching for config files in directories...");

for (const dir of searchDirs) {
    if (fs.existsSync(dir)) {
        console.log(`Checking directory: ${dir}`);
        try {
            const files = fs.readdirSync(dir);
            console.log(`Files in ${dir}: ${files.join(', ')}`);
            for (const f of files) {
                const fullPath = path.join(dir, f);
                const stats = fs.lstatSync(fullPath);
                if (stats.isFile() && (f.toLowerCase().includes('config') || f.toLowerCase().includes('settings') || f.toLowerCase().includes('policy') || f.endsWith('.json'))) {
                    console.log(`FOUND_FILE: ${fullPath}`);
                } else if (stats.isDirectory()) {
                    // One level deeper for likely candidates
                    if (f === 'User' || f === 'settings' || f === 'config') {
                        const subFiles = fs.readdirSync(fullPath);
                        console.log(`Sub-files in ${fullPath}: ${subFiles.join(', ')}`);
                    }
                }
            }
        } catch (e) {
            console.log(`ERROR reading ${dir}: ${e}`);
        }
    }
}

// Specifically check for Roaming\Antigravity\User\settings.json
const antiPath = path.join(process.env.APPDATA || '', 'Antigravity', 'User', 'settings.json');
if (fs.existsSync(antiPath)) {
    console.log(`FOUND_SPECIFIC: ${antiPath}`);
}
