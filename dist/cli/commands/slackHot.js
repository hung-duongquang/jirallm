// A Slack conversation going on right now, in a thread a session follows, is too slow through the
// scheduled `watch` (it starts once a minute and takes ~20 s; the monitor then looks every 30 s): a
// reply reached Claude a minute or more after it was posted. The session's monitor therefore runs
// `jirallm slack:hot --session <id>` every HOT_POLL_SECONDS while one of its followed threads (or the
// channel below one) had activity in the last HOT_MINUTES: one conversations.replies call per hot thread,
// logged to CHANGES.md like watch does, so the monitor pushes it in the same round.
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSlackAuth, SlackClient, threadFrontmatter } from '../../lib/slack.js';
import { belowChanges } from './slackBelow.js';
import { logChanges, slackChanges } from './watch.js';
export const HOT_MINUTES = 30;
export const HOT_POLL_SECONDS = 10;
/** The session's followed threads and "below" windows with activity in the last HOT_MINUTES. */
export function hotFollows(outputDir, session, sessionsDir = path.join(os.tmpdir(), 'jirallm-sessions'), now = Date.now()) {
    const threads = new Set();
    const below = new Set();
    const file = path.join(sessionsDir, `${session}.follow`);
    if (!existsSync(file))
        return { threads, below };
    const recent = (ms) => now - ms < HOT_MINUTES * 60_000;
    const belowState = (() => {
        try {
            return JSON.parse(readFileSync(path.join(outputDir, '.slack-below.json'), 'utf8'));
        }
        catch {
            return {};
        }
    })();
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const [, kind, dir] = /^(slack|below)\/([\w-]+)$/i.exec(line.trim()) ?? [];
        if (!kind || !dir)
            continue;
        const d = dir.toLowerCase();
        if (kind.toLowerCase() === 'below') {
            const s = belowState[d];
            if (s && !s.closed && recent(Number(s.newest) * 1000))
                below.add(d);
            continue;
        }
        const thread = path.join(outputDir, 'slack', d, 'thread.md');
        if (!existsSync(thread))
            continue;
        const fm = threadFrontmatter(readFileSync(thread, 'utf8'));
        if (recent(Date.parse(fm.lastReplyAt ?? '') || Number(fm.lastTs ?? 0) * 1000))
            threads.add(d);
    }
    return { threads, below };
}
/** `jirallm slack:hot --session <id>`: checks the session's hot threads now; prints the change lines it logged. */
export async function runSlackHot(opts) {
    const outputDir = opts.outputDir ?? './jira-export';
    const { threads, below } = hotFollows(outputDir, opts.session);
    if (!threads.size && !below.size)
        return;
    const client = new SlackClient(await loadSlackAuth());
    const changes = [
        ...(threads.size ? await slackChanges(outputDir, false, client, Date.now(), threads) : []),
        ...(below.size ? await belowChanges(outputDir, false, client, below) : []),
    ];
    // Errors (a rate limit) stay quiet: the scheduled watch reports them, and the next round retries.
    const lines = changes.filter((c) => !c.error).map((c) => c.line);
    if (lines.length) {
        logChanges(outputDir, lines);
        console.log(lines.join('\n'));
    }
}
//# sourceMappingURL=slackHot.js.map