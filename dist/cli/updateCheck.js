import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfigPath } from '../lib/config.js';
/** Where jirallm is installed from: the built `release` branch of our own repo (not the upstream npm package). */
export const RELEASE_REPO = 'hung-duongquang/jirallm';
export const RELEASE_SOURCE = `github:${RELEASE_REPO}#release`;
/** The release branch's package.json: its `version` is the latest release. */
export const RELEASE_PACKAGE_JSON_URL = `https://raw.githubusercontent.com/${RELEASE_REPO}/release/package.json`;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Fetches the version on the release branch. Sends nothing but a plain GET. */
export async function fetchLatestVersion(url = RELEASE_PACKAGE_JSON_URL) {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok)
        throw new Error(`Release check responded ${res.status} ${res.statusText}`);
    const json = (await res.json());
    if (!json.version)
        throw new Error('Release package.json has no "version" field');
    return json.version;
}
/** True when `latest` is a higher x.y.z than `current` (pre-release suffixes ignored). */
export function isNewer(latest, current) {
    const parse = (v) => v.replace(/^v/, '').split(/[-+]/)[0].split('.').map((n) => Number(n) || 0);
    const a = parse(latest);
    const b = parse(current);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0)
            return diff > 0;
    }
    return false;
}
export function updateStatePath() {
    return join(dirname(resolveConfigPath()), 'update-check.json');
}
function readState(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return {};
    }
}
export function writeState(state, path = updateStatePath()) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state));
}
export function updateCheckDisabled(argv = process.argv, env = process.env, isTTY = Boolean(process.stderr.isTTY)) {
    return 'NO_UPDATE_NOTIFIER' in env || Boolean(env.CI) || argv.includes('--json') || !isTTY;
}
/**
 * Daily update check, like update-notifier but against our release branch: prints a notice when an
 * earlier check found a newer version, and at most once per 24 h starts a detached background process
 * that refreshes the stored latest version (so the command itself never waits on the network).
 */
export function checkForUpdates(currentVersion, now = Date.now()) {
    if (updateCheckDisabled())
        return;
    const path = updateStatePath();
    const state = readState(path);
    if (state.latest && isNewer(state.latest, currentVersion)) {
        const latest = state.latest;
        process.once('exit', () => {
            process.stderr.write(`\nUpdate available ${currentVersion} → ${latest}\nRun \`jirallm upgrade\` to update.\n`);
        });
    }
    if (state.lastCheck !== undefined && now - state.lastCheck < CHECK_INTERVAL_MS)
        return;
    try {
        // Mark the check as started first, so parallel runs do not all spawn a worker.
        writeState({ ...state, lastCheck: now }, path);
        const worker = join(dirname(fileURLToPath(import.meta.url)), 'updateCheckWorker.js');
        spawn(process.execPath, [worker], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
    catch {
        // An update check must never break a command.
    }
}
//# sourceMappingURL=updateCheck.js.map