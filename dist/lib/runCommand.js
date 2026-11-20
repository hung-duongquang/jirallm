import { exec, spawn } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
export function runInteractive(command) {
    return new Promise((resolve) => {
        const child = spawn(command, { shell: true, stdio: 'inherit' });
        child.on('exit', (code) => resolve(code ?? 1));
        child.on('error', () => resolve(1));
    });
}
export async function runCommand(command, description, options = {}) {
    const { shouldThrow = true, silent = false } = options;
    if (!silent)
        console.info(`\n${description}...`);
    try {
        const { stdout, stderr } = await execAsync(command);
        if (!silent) {
            if (stderr)
                console.error(stderr);
            console.info(stdout);
        }
        return stdout.trim();
    }
    catch (error) {
        if (!silent) {
            console.error(`${description} failed:`, error instanceof Error ? error.message : String(error));
        }
        if (shouldThrow)
            throw error;
        return '';
    }
}
//# sourceMappingURL=runCommand.js.map