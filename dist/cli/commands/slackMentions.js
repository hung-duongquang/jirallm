/**
 * New Slack messages about the tickets open Claude Code sessions work on. `watch` follows only Slack
 * threads that were exported, so a new message elsewhere ("ZOD-1 don't merge yet" in a group DM)
 * never reached the session. Each Slack round searches Slack for the ticket keys of the running
 * sessions, exports the thread of every new message (so its replies are followed from then on), lets
 * those sessions follow it, and logs one change line naming the key, which the monitor hands to them.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportSlackThread, parseSlackUrl } from '../../lib/slack.js';
import { isRunning } from './resume.js';
const STATE_FILE = '.watch.slack-mentions.json';
const ISSUE_KEY = /^[A-Z][A-Z0-9]+-\d+$/;
/** A key searched for the first time looks back this far, so this morning's message is still found. */
const FIRST_LOOK_BACK_MS = 24 * 3600 * 1000;
/** Search calls per round (Slack allows about 20 a minute). */
const MAX_KEYS = 15;
/**
 * Ticket keys of the running Claude Code sessions, each with the sessions that follow it. Only keys
 * of a project with exported tickets count ("UTF-8" in a prompt is not a ticket), as in the prompt hook.
 */
export function runningSessionKeys(outputDir, sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions')) {
    const keys = new Map();
    if (!existsSync(sessionsDir))
        return keys;
    const projects = new Set((existsSync(outputDir) ? readdirSync(outputDir) : []).map((f) => /^([a-z][a-z0-9]*)-\d+$/.exec(f)?.[1]).filter(Boolean));
    for (const f of readdirSync(sessionsDir)) {
        if (!f.endsWith('.keys'))
            continue;
        const id = f.slice(0, -'.keys'.length);
        if (!isRunning(id, sessionsDir))
            continue;
        for (const k of readFileSync(path.join(sessionsDir, f), 'utf8').split(/\r?\n/).map((l) => l.trim())) {
            if (ISSUE_KEY.test(k) && projects.has(k.split('-')[0].toLowerCase()))
                keys.set(k, [...(keys.get(k) ?? []), id]);
        }
    }
    return keys;
}
/** Export folder of the thread a search hit belongs to ("<channel>-<thread ts without the dot>"). */
export function threadDirOf(permalink) {
    const link = parseSlackUrl(permalink);
    return `${link.channel.toLowerCase()}-${(link.threadTs ?? link.ts).replace('.', '')}`;
}
function follow(sessionsDir, sessions, item) {
    for (const id of sessions) {
        const file = path.join(sessionsDir, `${id}.follow`);
        const followed = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [];
        if (followed.includes(item))
            continue;
        appendFileSync(file, `${followed.length && !readFileSync(file, 'utf8').endsWith('\n') ? '\n' : ''}${item}\n`);
    }
}
const day = (ms) => new Date(ms - 24 * 3600 * 1000).toISOString().slice(0, 10);
const oneLine = (text) => {
    const line = text.replace(/<([^|>]+)\|([^>]+)>/g, '$2').replace(/<([^>]+)>/g, '$1').replace(/\s+/g, ' ').trim();
    return line.length > 100 ? `${line.slice(0, 99)}…` : line;
};
/**
 * One round: for each key of a running session, Slack messages since the last round (the first time:
 * the last 24 h), not written by the token's own user. A message in a thread that is already exported
 * is left to `slackChanges` (it reports the thread's new replies); the session only starts following it.
 */
export async function slackMentionChanges(outputDir, client, opts = {}) {
    const sessionsDir = opts.sessionsDir ?? path.join(os.tmpdir(), 'jirallm-sessions');
    const now = opts.now ?? Date.now();
    const keys = runningSessionKeys(outputDir, sessionsDir);
    if (keys.size === 0)
        return [];
    const stateFile = path.join(outputDir, STATE_FILE);
    let state = {};
    try {
        state = JSON.parse(readFileSync(stateFile, 'utf8'));
    }
    catch {
        // First round.
    }
    const me = (await client.call('auth.test', {})).user_id;
    const changes = [];
    for (const [key, sessions] of [...keys].slice(0, MAX_KEYS)) {
        const since = Number(state[key] ?? (now - FIRST_LOOK_BACK_MS) / 1000);
        let matches;
        try {
            // `after:` takes a day and excludes it: ask from the day before and filter on ts.
            matches = (await client.search(`${key} after:${day(since * 1000)}`, 20)).matches;
        }
        catch (err) {
            changes.push({ line: `slack search ${key}: check failed (${String(err instanceof Error ? err.message : err).split('\n')[0]})`, error: true });
            break;
        }
        const fresh = matches.filter((m) => Number(m.ts) > since && m.user !== me && m.permalink).sort((a, b) => Number(a.ts) - Number(b.ts));
        const threads = new Map();
        for (const m of fresh) {
            try {
                if (!threads.has(threadDirOf(m.permalink)))
                    threads.set(threadDirOf(m.permalink), m);
            }
            catch {
                // Not a message link (a file share): skipped.
            }
        }
        for (const [dir, m] of threads) {
            const item = `slack/${dir}`;
            const exported = existsSync(path.join(outputDir, 'slack', dir, 'thread.md'));
            if (opts.dryRun) {
                if (!exported)
                    changes.push({ line: `${item}: would export (new message about ${key})`, url: m.permalink });
                continue;
            }
            follow(sessionsDir, sessions, item);
            if (exported)
                continue;
            try {
                await exportSlackThread(m.permalink, { outputDir, client });
                const where = m.channel?.is_im || m.channel?.is_mpim ? 'a DM' : m.channel?.name ? `#${m.channel.name}` : 'Slack';
                changes.push({ line: `${item}: new message about ${key} from ${m.username ?? 'someone'} in ${where}: "${oneLine(m.text ?? '')}"`, url: m.permalink });
            }
            catch (err) {
                changes.push({ line: `${item}: export failed (${String(err instanceof Error ? err.message : err).split('\n')[0]})`, error: true });
            }
        }
        if (!opts.dryRun)
            state[key] = String(Math.max(since, ...fresh.map((m) => Number(m.ts))));
    }
    if (!opts.dryRun) {
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(stateFile, JSON.stringify(state, null, 2));
    }
    return changes;
}
//# sourceMappingURL=slackMentions.js.map