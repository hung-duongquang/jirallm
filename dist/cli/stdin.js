import { readFileSync } from 'fs';
export function readPipedStdin(hint) {
    if (process.stdin.isTTY) {
        throw new Error(`stdin is a terminal — ${hint}`);
    }
    return readFileSync(0, 'utf-8');
}
export function readTokenFromStdin({ example, fallback }) {
    const raw = readPipedStdin(`pipe the token, e.g. ${example}, or drop --token-stdin to ${fallback}.`).trim();
    if (!raw)
        throw new Error('--token-stdin was set but no token was received on stdin.');
    return raw;
}
//# sourceMappingURL=stdin.js.map