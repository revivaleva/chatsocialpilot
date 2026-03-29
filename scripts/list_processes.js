import { execSync } from 'child_process';
try {
    const output = execSync('tasklist /FI "IMAGENAME eq node.exe" /V').toString();
    console.log(output);
} catch (e) {
    console.error(e);
}
