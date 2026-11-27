import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OTHER_ITEM, pendingCounts, readAck, readDeliveries, WATCH_AT_MARKER } from './watch.js';
/** A watch run older than this means the scheduled task stopped (it normally runs every 1–15 minutes). */
const STALE_MINUTES = 20;
const SESSION_ID = /^[\w-]{1,100}$/;
const hhmm = (ms) => new Date(ms).toLocaleTimeString('sv-SE').slice(0, 5);
/**
 * What the session follows: the ticket keys its prompts named (`<id>.keys`) and the Slack threads
 * they linked (`<id>.follow`, "slack/<channel>-<ts>"), both kept by the plugin's prompt hook.
 */
export function sessionKeys(session, dir = path.join(os.tmpdir(), 'jirallm-sessions')) {
    if (!session || !SESSION_ID.test(session))
        return [];
    const read = (file) => {
        try {
            return readFileSync(path.join(dir, file), 'utf-8').split('\n').map((k) => k.trim()).filter(Boolean);
        }
        catch {
            return [];
        }
    };
    return [...read(`${session}.keys`), ...read(`${session}.follow`)];
}
/** "📥 #3 11:30 PR #12 → ✓ read 11:31" for the last delivery to the session, or ''. */
function lastDelivery(outputDir, session) {
    const log = readDeliveries(outputDir, session);
    const last = log[log.length - 1];
    if (!last)
        return '';
    const names = last.items.filter((i) => i !== OTHER_ITEM).map((i) => (i.startsWith('slack/') ? 'Slack' : i.startsWith('confluence/') ? 'Confluence' : i.replace(/^PR (#\d+) \([^)]*\)$/, 'PR $1')));
    const what = names.length ? names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '') : 'other tickets';
    const ack = readAck(outputDir, session);
    const read = ack && ack.n >= last.n ? `✓ read ${hhmm(Date.parse(ack.at))}` : '⏳ not read yet';
    return `📥 #${last.n} ${hhmm(Date.parse(last.at))} ${what} → ${read}`;
}
/**
 * One status-line segment for Claude Code: whether the scheduled `watch` is alive (time of its last
 * run, or how long it has been idle), the last change report handed to this session and whether a
 * Claude turn has read it, changes to the session's tickets still waiting, and other tickets' changes.
 * Empty when the workspace has no export directory.
 */
export function statusLine(outputDir, session, now = Date.now(), keys = sessionKeys(session)) {
    if (!existsSync(outputDir))
        return '';
    const marker = path.join(outputDir, WATCH_AT_MARKER);
    const [iso, ...rest] = existsSync(marker) ? readFileSync(marker, 'utf-8').trim().split(' ') : [];
    const at = iso ? Date.parse(iso) : NaN;
    let watch;
    if (Number.isNaN(at))
        watch = 'jirallm ⚠ watch not running';
    else {
        const minutes = Math.floor((now - at) / 60_000);
        const errors = rest.length ? ` ⚠ ${rest.join(' ')}` : '';
        watch =
            minutes > STALE_MINUTES
                ? `jirallm ⚠ watch idle ${minutes < 120 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`}`
                : `jirallm ✓ ${hhmm(at)}${errors}`;
    }
    const parts = [watch];
    try {
        const id = session && SESSION_ID.test(session) ? session : undefined;
        const delivered = id ? lastDelivery(outputDir, id) : '';
        const { waiting, others } = pendingCounts(outputDir, id, keys);
        if (delivered)
            parts.push(delivered);
        if (waiting)
            parts.push(`⏳ ${waiting} waiting for Claude`);
        if (others)
            parts.push(`+${others} other`);
        if (!delivered && !waiting && !others)
            parts.push('Claude up to date');
    }
    catch {
        // A status line never fails.
    }
    return parts.join(' · ');
}
/** `jirallm status-line`: reads Claude Code's status-line JSON on stdin (session id, project dir) and prints the segment. */
export function runStatusLine(opts) {
    let input = {};
    try {
        if (!process.stdin.isTTY)
            input = JSON.parse(readFileSync(0, 'utf-8') || '{}');
    }
    catch {
        // No or bad stdin: use the current directory.
    }
    const project = input.workspace?.project_dir ?? input.cwd ?? process.cwd();
    const outputDir = opts.outputDir ?? path.join(project, 'jira-export');
    const line = statusLine(outputDir, input.session_id);
    if (line)
        console.log(line);
}
//# sourceMappingURL=statusLine.js.map