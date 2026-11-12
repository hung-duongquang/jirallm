import { intro, outro, password, isCancel, cancel } from '@clack/prompts';
import { removeSecret, setSecret } from '../../lib/credentials.js';
import { SLACK_COOKIE_ACCOUNT, SLACK_NOT_SET_UP, SLACK_TOKEN_ACCOUNT, SlackClient, exportSlackThread, hasSlackToken, loadSlackAuth, loadSlackThread, formatTs, mentionedUsers, parseSince, renderThread, searchHits, slackSearchQueries, threadTitle, } from '../../lib/slack.js';
import { printJson } from '../jsonOutput.js';
/** One line naming the thread, most telling part first: `<first line of its first message> · #channel`. */
export function slackTitleLine(channelName, title) {
    const where = !channelName ? '' : channelName === 'direct message' ? ' · DM' : ` · #${channelName}`;
    return `${title}${where}`;
}
/**
 * Prints a Slack message with its whole thread as Markdown, or with --output-dir writes
 * <dir>/slack/<channel>-<ts>/thread.md and downloads the thread's files next to it.
 */
export async function runSlack(url, opts) {
    if (opts.title) {
        const { channelName, messages, names } = await loadSlackThread(url, undefined, { channel: false });
        console.log(slackTitleLine(channelName, threadTitle(messages, names)));
        return;
    }
    if (opts.outputDir && !opts.json) {
        const thread = await exportSlackThread(url, { outputDir: opts.outputDir, files: opts.files, channel: opts.channel, frames: opts.frames });
        for (const err of thread.fileErrors)
            console.error(`# ${err}`);
        console.log(thread.path);
        return;
    }
    const { link, url: messageUrl, channelName, messages, channelMessages, names } = await loadSlackThread(url, undefined, {
        channel: opts.channel,
    });
    if (opts.json) {
        printJson({ link, channelName, users: Object.fromEntries(names), messages, channelMessages });
        return;
    }
    const since = opts.since ? parseSince(opts.since) : undefined;
    process.stdout.write(renderThread({ url: messageUrl, channelName, messages, channelMessages, linkedTs: link.ts, names, since }));
}
/**
 * Searches Slack messages and prints one TSV row per thread (newest match): date, channel, author,
 * matches in the thread, text, permalink. Open a hit with `jirallm slack <url>`.
 */
export async function runSlackSearch(query, opts) {
    const max = opts.max ? Number(opts.max) : 20;
    if (!Number.isInteger(max) || max < 1 || max > 500)
        throw new Error(`--max needs a number from 1 to 500, got: ${opts.max}`);
    const queries = slackSearchQueries(query, opts.after);
    if (queries.length === 0)
        throw new Error('Empty search query.');
    const q = queries.join(' | ');
    // Slack is optional: without a token this is not an error, just nothing to search.
    if (!(await hasSlackToken())) {
        if (opts.json)
            printJson({ skipped: SLACK_NOT_SET_UP, matches: [] });
        else
            console.log(SLACK_NOT_SET_UP);
        return;
    }
    const client = new SlackClient(await loadSlackAuth());
    const { total, matches } = await client.searchAny(queries, max);
    const ids = new Set();
    for (const m of matches) {
        if (m.user)
            ids.add(m.user);
        for (const id of mentionedUsers(m.text ?? ''))
            ids.add(id);
    }
    const names = new Map();
    for (const id of ids)
        names.set(id, await client.userName(id));
    const hits = searchHits(matches, names);
    // Replies rarely repeat the key, so a thread's newest activity is shown even when it did not match.
    if (opts.threads !== false) {
        for (const h of hits.slice(0, MAX_THREAD_INFO)) {
            if (!h.channelId || !h.threadTs)
                continue;
            try {
                const info = await client.threadInfo(h.channelId, h.threadTs);
                h.replies = info.replies;
                h.lastReply = info.latestReply;
            }
            catch {
                // Thread info is a bonus (e.g. a DM the token cannot read).
            }
        }
    }
    if (opts.json) {
        printJson({ query: q, total, hits });
        return;
    }
    console.error(`# ${q}: ${total} message(s)${total > matches.length ? `, showing the newest ${matches.length}` : ''}, ${hits.length} thread(s)`);
    if (hits.length === 0)
        return;
    console.log(['date', 'channel', 'author', 'matches', 'replies', 'last reply', 'text', 'url'].join('\t'));
    for (const h of hits) {
        const replies = h.replies === undefined ? '' : String(h.replies);
        const last = h.lastReply ? formatTs(h.lastReply) : '';
        console.log([h.date, h.channel, h.author, String(h.more + 1), replies, last, h.text.replace(/\t/g, ' '), h.url].join('\t'));
    }
}
/** Threads whose reply count is looked up (one conversations.replies call each). */
const MAX_THREAD_INFO = 25;
export async function runSlackAuth(opts) {
    if (opts.remove) {
        const a = await removeSecret(SLACK_TOKEN_ACCOUNT);
        const b = await removeSecret(SLACK_COOKIE_ACCOUNT);
        console.log(a || b ? 'Removed the Slack token.' : 'No Slack token stored.');
        return;
    }
    if (!opts.check) {
        intro('jirallm slack:auth');
        const token = await password({
            message: 'Slack token (xoxp- user token from a Slack app with channels:history, groups:history, im:history, mpim:history, users:read, search:read; or an xoxc- browser token)',
            validate: (v) => (/^xox[pcb]-/.test(v ?? '') ? undefined : 'Expected a token starting with xoxp-, xoxb- or xoxc-'),
        });
        if (isCancel(token)) {
            cancel('Cancelled.');
            return;
        }
        await setSecret(SLACK_TOKEN_ACCOUNT, token);
        if (token.startsWith('xoxc-')) {
            const cookie = await password({
                message: 'Value of the "d" cookie (starts with xoxd-) from the same browser session',
                validate: (v) => (v ? undefined : 'Required for an xoxc- token'),
            });
            if (isCancel(cookie)) {
                cancel('Cancelled.');
                return;
            }
            await setSecret(SLACK_COOKIE_ACCOUNT, cookie);
        }
        else {
            await removeSecret(SLACK_COOKIE_ACCOUNT);
        }
        outro('Stored in the OS keychain.');
    }
    const res = await new SlackClient(await loadSlackAuth()).call('auth.test', {});
    console.log(`Slack OK: ${res.user} on ${res.team} (${res.url})`);
}
//# sourceMappingURL=slack.js.map