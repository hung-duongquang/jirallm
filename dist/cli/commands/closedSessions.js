/**
 * News for Claude sessions that are not running. A change reaches a session only while it runs (its
 * monitor, its next prompt), so a review that comes in after the user closed the session for the day
 * waits unseen until that session is opened again, and the user hears of it only from a GitHub email.
 * With `watch --closed-sessions`:
 * - the watch shows one toast per closed session with something to act on (a review, failed CI, a
 *   merge, a new comment or reply), with "Resume session"; one per session until it runs again;
 * - the first prompt after a time away, in any session, gets one line naming the closed sessions with
 *   news (`jirallm sessions:news`, which the prompt hook runs), so it also works when the toast was missed.
 * The watch leaves a marker file while the option is on; without it `sessions:news` prints nothing.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extensionAvailable, installExtension, resumeUri } from '../../lib/vscodeExtension.js';
import { toast } from './prStatus.js';
import { claudeSessions } from './sessions.js';
import { waitingLines } from './watch.js';
/** What is worth interrupting for: someone reviewed, CI failed, it merged, a new comment, reply or message. */
export const IMPORTANT = /\breviewed:|\bCI failed\b|: merged\b|\bnew comments?\b|\bnew repl(?:y|ies)\b|\bnew message about\b|\bawaiting\b|tagged you|changes requested/i;
/** Written by each watch run with --closed-sessions; the hook's summary needs it to be recent. */
export const MARKER = '.watch.closed-sessions';
const STATE = '.watch.closed-sessions.json';
const MARKER_FRESH_MS = 24 * 3600 * 1000;
/** The summary at a return covers changes of the last few days (older ones are not news any more). */
const SUMMARY_DAYS = 3;
const defaultSessionsDir = () => path.join(os.tmpdir(), 'jirallm-sessions');
function sessionCwd(id, sessionsDir) {
    const read = (f) => {
        try {
            return readFileSync(path.join(sessionsDir, f), 'utf8');
        }
        catch {
            return '';
        }
    };
    const saved = read(`${id}.open`).trim() || read(`${id}.start`).split('\n')[0]?.trim() || '';
    return saved && existsSync(saved) ? saved : '';
}
/** Change-log stamp ("YYYY-MM-DD HH:MM:SS", local time) of a moment. */
export const stampOf = (ms) => new Date(ms).toLocaleString('sv-SE').slice(0, 19);
/** Closed sessions of this workspace with important changes waiting (logged at or after `since`), newest activity first. */
export function closedSessionNews(outputDir, sessionsDir = defaultSessionsDir(), now = Date.now(), since = '') {
    const out = [];
    for (const s of claudeSessions(outputDir, 7, sessionsDir, now)) {
        if (s.running || !s.keys.length)
            continue;
        const lines = waitingLines(outputDir, s.id, s.keys, since).filter((l) => IMPORTANT.test(l));
        if (lines.length)
            out.push({ id: s.id, title: s.title || s.keys.slice(0, 3).join(', '), lines: [...new Set(lines)], cwd: sessionCwd(s.id, sessionsDir) });
    }
    return out;
}
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** "PR #3299 (ZOD-4250): CI failed: Flag cold tier changes — jirallm pr-status 3299" → without the command hint. */
const tidy = (line) => line.replace(/ — jirallm [^—]+$/, '');
/**
 * One toast per closed session with news, until the session runs again (or its news is gone):
 * the state file remembers which sessions were told. Also refreshes the marker for the hook.
 */
export function notifyClosedSessions(outputDir, opts = {}) {
    const now = opts.now ?? Date.now();
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(path.join(outputDir, MARKER), new Date(now).toISOString());
    const stateFile = path.join(outputDir, STATE);
    let state = {};
    try {
        state = JSON.parse(readFileSync(stateFile, 'utf8'));
    }
    catch {
        // First run.
    }
    // Only changes from when the option was switched on: a backlog of old sessions stays quiet.
    const since = state.since ?? stampOf(now);
    const told = state.told ?? {};
    const news = closedSessionNews(outputDir, opts.sessionsDir, now, since);
    // A session that runs again, or whose news was delivered, may be told again next time.
    const withNews = new Set(news.map((n) => n.id));
    for (const id of Object.keys(told))
        if (!withNews.has(id))
            delete told[id];
    const fresh = news.filter((n) => !told[n.id]);
    if (fresh.length) {
        const vscode = process.platform === 'win32' && extensionAvailable() && !installExtension();
        for (const n of fresh.slice(0, 3)) {
            (opts.show ?? toast)(`Closed session: ${short(n.title, 60)}`, [...n.lines.slice(0, 2).map(tidy), ...(n.lines.length > 2 ? [`+${n.lines.length - 2} more`] : [])], undefined, vscode && n.cwd ? [{ label: 'Resume session', url: resumeUri(n.id, n.cwd, n.title) }] : []);
            told[n.id] = new Date(now).toISOString();
        }
    }
    writeFileSync(stateFile, JSON.stringify({ since, told }, null, 2));
    return fresh;
}
/**
 * `jirallm sessions:news [--exclude <id>]`: one short block for the prompt hook, naming the closed
 * sessions with news and how to open them; nothing when there is none or --closed-sessions is off.
 */
export function sessionsNewsText(outputDir, exclude, sessionsDir = defaultSessionsDir(), now = Date.now()) {
    try {
        if (now - statSync(path.join(outputDir, MARKER)).mtimeMs > MARKER_FRESH_MS)
            return '';
    }
    catch {
        return '';
    }
    const news = closedSessionNews(outputDir, sessionsDir, now, stampOf(now - SUMMARY_DAYS * 24 * 3600 * 1000)).filter((n) => n.id !== exclude);
    if (!news.length)
        return '';
    return [
        `Closed Claude sessions with news while the user was away (tell the user in one or two lines; they can open one with \`jirallm resume <id>\` or Resume in \`jirallm ui\`):`,
        ...news.slice(0, 5).map((n) => `- ${short(n.title, 70)} (${n.id}): ${n.lines.slice(0, 3).map((l) => short(tidy(l), 110)).join('; ')}${n.lines.length > 3 ? `; +${n.lines.length - 3} more` : ''}`),
    ].join('\n');
}
//# sourceMappingURL=closedSessions.js.map