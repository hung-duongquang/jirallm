/**
 * Slack messages that tag the user (<@me>) outside what a running Claude session already follows: a
 * "check this on PRD @you" in a group DM names no ticket, so neither the ticket search
 * (slackMentions) nor the thread watch would ever see it. Each Slack round searches for new tags
 * (one search call), exports the thread, keeps it in an inbox (`.slack-tags.json` in the export dir:
 * `jirallm ui` lists it) and shows a toast whose "Handle in Claude" starts a new session on it
 * (`jirallm slack:handle <folder>`). Nothing is answered automatically: the session starts with the
 * thread and waits for the user, who decides what is worth a session.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportSlackThread, threadFrontmatter } from '../../lib/slack.js';
import { extensionAvailable, handleUri, installExtension, openUri } from '../../lib/vscodeExtension.js';
import { isRunning, openJirallmWindow } from './resume.js';
import { threadDirOf } from './slackMentions.js';
export const TAGS_FILE = '.slack-tags.json';
/** The first round looks back this far, so a tag from just before the watch started is not lost. */
const FIRST_LOOK_BACK_MS = 2 * 3600 * 1000;
/** Tags kept in the inbox (newest first). */
const INBOX_MAX = 50;
/** A Slack export folder: <channel id>-<thread ts without the dot>. */
export const SLACK_DIR = /^[a-z0-9]{1,20}-\d{16}$/;
export function readTags(outputDir) {
    try {
        const state = JSON.parse(readFileSync(path.join(outputDir, TAGS_FILE), 'utf8'));
        return { ...state, tags: Array.isArray(state.tags) ? state.tags : [] };
    }
    catch {
        return { tags: [] };
    }
}
function writeTags(outputDir, state) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(path.join(outputDir, TAGS_FILE), JSON.stringify({ ...state, tags: state.tags.slice(0, INBOX_MAX) }, null, 2));
}
/** Items (slack/<dir>, PROJ-1, …) the running Claude sessions follow. */
function followedByRunning(sessionsDir) {
    const items = new Set();
    if (!existsSync(sessionsDir))
        return items;
    for (const f of readdirSafe(sessionsDir)) {
        if (!f.endsWith('.follow'))
            continue;
        const id = f.slice(0, -'.follow'.length);
        if (!isRunning(id, sessionsDir))
            continue;
        for (const line of readFileSync(path.join(sessionsDir, f), 'utf8').split(/\r?\n/))
            if (line.trim())
                items.add(line.trim().toLowerCase());
    }
    return items;
}
function readdirSafe(dir) {
    try {
        return readdirSync(dir);
    }
    catch {
        return [];
    }
}
const day = (ms) => new Date(ms - 24 * 3600 * 1000).toISOString().slice(0, 10);
const oneLine = (text) => {
    const line = text.replace(/<@[A-Z0-9]+>/g, '@…').replace(/<([^|>]+)\|([^>]+)>/g, '$2').replace(/<([^>]+)>/g, '$1').replace(/\s+/g, ' ').trim();
    return line.length > 100 ? `${line.slice(0, 99)}…` : line;
};
/**
 * One round: messages since the last round that tag the user, not written by them. A thread a
 * running session follows is left to it (the thread watch hands it the new reply). Others are
 * exported and put at the top of the inbox, unhandled again if they were handled before.
 */
export async function slackTagChanges(outputDir, client, opts = {}) {
    const sessionsDir = opts.sessionsDir ?? path.join(os.tmpdir(), 'jirallm-sessions');
    const now = opts.now ?? Date.now();
    const state = readTags(outputDir);
    const me = state.me ?? (await client.call('auth.test', {})).user_id;
    if (!me)
        return [];
    const since = Number(state.since ?? (now - FIRST_LOOK_BACK_MS) / 1000);
    // `after:` takes a day and excludes it: ask from the day before and filter on ts.
    const matches = (await client.search(`<@${me}> after:${day(since * 1000)}`, 20)).matches;
    const fresh = matches
        .filter((m) => Number(m.ts) > since && m.user !== me && m.permalink && (m.text ?? '').includes(`<@${me}>`))
        .sort((a, b) => Number(b.ts) - Number(a.ts));
    const threads = new Map();
    for (const m of fresh) {
        try {
            const dir = threadDirOf(m.permalink);
            if (!threads.has(dir))
                threads.set(dir, m); // the newest tag of each thread
        }
        catch {
            // Not a message link (a file share): skipped.
        }
    }
    const followed = followedByRunning(sessionsDir);
    const changes = [];
    for (const [dir, m] of [...threads].reverse()) {
        const item = `slack/${dir}`;
        if (followed.has(item))
            continue;
        const where = m.channel?.is_im ? 'a DM' : m.channel?.is_mpim ? 'a group DM' : m.channel?.name ? `#${m.channel.name}` : 'Slack';
        const from = m.username ?? 'someone';
        const text = oneLine(m.text ?? '');
        if (opts.dryRun) {
            changes.push({ line: `${item}: would export (${from} tagged you in ${where})`, url: m.permalink });
            continue;
        }
        try {
            await (opts.exportThread ? opts.exportThread(m.permalink) : exportSlackThread(m.permalink, { outputDir, client }));
        }
        catch (err) {
            changes.push({ line: `${item}: export failed (${String(err instanceof Error ? err.message : err).split('\n')[0]})`, error: true });
            continue;
        }
        const tag = { dir, url: m.permalink, from, where, text, ts: m.ts };
        state.tags = [tag, ...state.tags.filter((t) => t.dir !== dir)];
        changes.push({ line: `${item}: ${from} tagged you in ${where}: "${text}"`, url: m.permalink, tag });
    }
    if (!opts.dryRun) {
        writeTags(outputDir, { ...state, me, since: String(Math.max(since, ...fresh.map((m) => Number(m.ts)))) });
    }
    return changes;
}
/** Marks a tag handled or dismissed in the inbox; false when it is not there. */
export function markTag(outputDir, dir, how) {
    const state = readTags(outputDir);
    const tag = state.tags.find((t) => t.dir === dir);
    if (!tag)
        return false;
    if (how === 'dismissed')
        tag.dismissed = true;
    else
        tag.handledAt = new Date().toISOString();
    writeTags(outputDir, state);
    return true;
}
/** The first prompt of the session that handles a tag: the thread link (the prompt hook follows it) and the ground rules. */
export function handlePrompt(tag, threadFile) {
    return [
        `${tag.from} tagged me in ${tag.where}: ${tag.url}`,
        `Their message: "${tag.text}"`,
        `The thread is exported at ${threadFile}. Read it (and its images), then tell me in short what is asked and how you would handle it.`,
        'Ask me before anything that writes (Slack, Jira, GitHub) or touches production.',
    ].join('\n');
}
/**
 * `jirallm slack:handle <folder>`: starts a new Claude session on a tagged Slack thread, in the
 * workspace (the export dir's parent), and marks the tag handled. Runs in the terminal the toast or
 * `jirallm ui` opened; Claude takes it over.
 */
export async function runSlackHandle(dir, opts = {}) {
    if (!SLACK_DIR.test(dir))
        throw new Error(`Not a Slack thread folder: ${dir} (expected <channel>-<ts>, as under jira-export/slack/)`);
    const outputDir = path.resolve(opts.outputDir ?? './jira-export');
    const threadFile = path.join(outputDir, 'slack', dir, 'thread.md');
    if (!existsSync(threadFile))
        throw new Error(`No exported thread at ${threadFile}.`);
    const fm = threadFrontmatter(readFileSync(threadFile, 'utf8'));
    const tag = readTags(outputDir).tags.find((t) => t.dir === dir) ?? { url: fm.url ?? '', from: 'Someone', where: 'Slack', text: fm.title ?? '' };
    markTag(outputDir, dir, 'handled');
    const prompt = handlePrompt(tag, path.relative(path.dirname(outputDir), threadFile).replace(/\\/g, '/'));
    // Ctrl+C belongs to Claude (cancel, twice to quit); this process only waits for it.
    process.on('SIGINT', () => { });
    const child = spawn('claude', [prompt], { cwd: path.dirname(outputDir), stdio: 'inherit' });
    await new Promise((resolve) => {
        child.on('exit', (code) => {
            process.exitCode = code ?? 0;
            resolve();
        });
        child.on('error', (err) => {
            console.error(`Could not start claude: ${err.message}`);
            process.exitCode = 1;
            resolve();
        });
    });
}
/**
 * Opens a terminal that runs `jirallm slack:handle <dir>` in the workspace: in VS Code through the
 * jirallm sessions extension when VS Code is there, else in a terminal window.
 */
export function openHandleTerminal(dir, outputDir) {
    if (!SLACK_DIR.test(dir))
        throw new Error(`Not a Slack thread folder: ${dir}`);
    const workspace = path.dirname(path.resolve(outputDir));
    let note;
    if (extensionAvailable()) {
        note = installExtension() || undefined;
        if (!note) {
            openUri(handleUri(dir, workspace));
            return { where: 'vscode' };
        }
    }
    openJirallmWindow(['slack:handle', dir], workspace, 'claude: Slack tag');
    return { where: 'window', ...(note && { note }) };
}
//# sourceMappingURL=slackTags.js.map