import { type JqlIssue } from '../../lib/jiraClient.js';
import { SlackClient } from '../../lib/slack.js';
import { type Gh } from './prStatus.js';
export type WatchOptions = {
    org?: string;
    outputDir?: string;
    jql?: string;
    mine?: boolean;
    pages?: boolean;
    every?: string;
    install?: string | boolean;
    uninstall?: boolean;
    dryRun?: boolean;
    prs?: string;
    jiraEvery?: string;
    notify?: boolean;
    quiet?: boolean;
    slack?: boolean;
    slackEvery?: string;
};
/** ISO time of the last finished `watch` run, plus an error count (the status line shows whether the watcher is alive). */
export declare const WATCH_AT_MARKER = ".watch.at";
/** Threads quiet for longer than this are no longer checked; exporting one again picks it back up. */
export declare const SLACK_IDLE_DAYS = 14;
type LocalIssue = {
    key: string;
    updatedAt?: string;
    commentsUpdatedAt?: string;
    commentCount?: number;
};
/** Reads `key: "value"` lines from a markdown file's frontmatter (top-level and one nested level). */
export declare function frontmatter(md: string): Record<string, string>;
/** One line per changed frontmatter field plus the `##` sections whose text changed. */
export declare function describeChange(previous: string | null, current: string): string;
/**
 * Jira does not move the issue's `updated` when a comment is edited or deleted, so compare the newest
 * comment timestamp (exports without `commentsUpdatedAt` fall back to `updatedAt`) and the comment count
 * (skipped for exports without `commentCount`) with what the export saw.
 */
export declare function commentsChangedSince(known: LocalIssue, issue: JqlIssue): boolean;
/** A change line for CHANGES.md, with the page a notification should open; `error` lines are only printed. */
export type PrChange = {
    line: string;
    url?: string;
    error?: boolean;
};
/**
 * CI and review changes on my open PRs in the repo at `repo` since the last run (state in .prs.json):
 * new check failures, CI back to green, new reviews, review threads awaiting me, comments, merged/closed.
 * Cheap enough to run every minute: one `gh pr list` (checks of all my PRs) plus a notifications poll
 * that is a free 304 when nothing happened; a PR is only read in full when its checks changed or it
 * got a notification.
 */
export declare function prChanges(repo: string, outputDir: string, dryRun: boolean | undefined, gh?: Gh): PrChange[];
/**
 * New replies in exported Slack threads (slack/<channel>-<ts>/thread.md) since their export: one
 * conversations.replies call per thread, asking only for messages after the export's last one.
 * A thread with new replies is exported again (which marks them as new). Threads without a reply for
 * SLACK_IDLE_DAYS are skipped; Slack rate limiting stops the round and the rest waits for the next.
 */
export declare function slackChanges(outputDir: string, dryRun: boolean | undefined, client?: SlackClient, now?: number): Promise<PrChange[]>;
export type ChangesOptions = {
    outputDir?: string;
    unseen?: boolean;
    max?: string;
    follow?: string | boolean;
    session?: string;
    keys?: string;
    pushOnly?: boolean;
    via?: string;
    log?: boolean;
};
/** Path of the seen marker for a session (validated id), or of the shared one without a session. */
export declare function seenMarkerPath(outputDir: string, session?: string): string;
/** The stamp a session has seen up to: its own marker, else the shared one (what earlier sessions saw). */
export declare function seenStamp(outputDir: string, session?: string): string;
/** Number of change lines (latest state per item) the session has not seen yet; nothing is marked. */
export declare function unseenCount(outputDir: string, session?: string): number;
/** Splits CHANGES.md into its `## <stamp>` entries, oldest first. */
export declare function changeEntries(md: string): {
    stamp: string;
    lines: string[];
}[];
/**
 * Prints the logged changes, newest last, capped at `--max` lines. With `--unseen` only entries
 * after the last `--unseen` call are printed (nothing at all when there are none), so a
 * session-start hook adds context only when something moved. `--follow [seconds]` keeps going:
 * every N seconds (default 30) it prints what `watch` appended since, as `--unseen` does, so an
 * agent's background monitor (each stdout line is an event) hears about it mid-session.
 */
export declare function runChanges(opts: ChangesOptions): Promise<void>;
/** One report handed to a Claude Code session, as logged in `.changes.seen.d/<id>.log` (JSON lines). */
export type Delivery = {
    n: number;
    at: string;
    via: string;
    items: string[];
    text?: string;
};
/** Written by the plugin's Stop hook: the highest delivery number a finished Claude turn had in context. */
export type DeliveryAck = {
    n: number;
    at: string;
    reply?: string;
};
export declare const deliveryLogPath: (outputDir: string, session: string) => string;
export declare const deliveryAckPath: (outputDir: string, session: string) => string;
export declare const OTHER_ITEM = "other tickets (names only)";
export declare function readDeliveries(outputDir: string, session: string): Delivery[];
/**
 * The session's read receipt (written by the plugin's PostToolUse/Stop hooks when Claude acted after a
 * delivery), with the first line of Claude's latest reply from `<id>.reply` (Stop hook) when there is one.
 */
export declare function readAck(outputDir: string, session: string): DeliveryAck | undefined;
/**
 * Logs a report handed to a session and prefixes it with "[jirallm delivery #N · via HH:MM]", so the
 * plugin's Stop hook can tell from the transcript which deliveries a finished Claude turn had in
 * context, and the status line can show "delivered → read". Without a session: the report as is.
 */
export declare function tagDelivery(outputDir: string, session: string | undefined, via: string, report: string | null, now?: Date): string | null;
/** `changes --log`: what was handed to a session, when and how, and whether a Claude turn has read it. */
export declare function deliveryLogReport(outputDir: string, session: string | undefined, max: number): string;
/**
 * For the status line: unseen changes to the session's tickets not handed to it yet (`waiting`),
 * and unseen changes to other tickets (`others`, which only arrive as one line of names).
 */
export declare function pendingCounts(outputDir: string, session: string | undefined, keys: string[]): {
    waiting: number;
    others: number;
};
/**
 * The compact change report (header, then one line per item with the latest state), or null when
 * there is nothing to show. With `unseen` only entries after the seen marker count, and the marker
 * moves past them: the session's own marker when `session` is given (so each Claude Code session
 * hears about every change, not only the first one to look), else the shared `.changes.seen`.
 */
export declare function changesReport(outputDir: string, unseen: boolean, max: number, session?: string, focus?: ChangeFocus): string | null;
/**
 * Which changes concern a session: the tickets it works on (`keys`). With `pushOnly` (the background
 * monitor) only those are printed and the session's seen marker is left alone; a separate
 * "pushed" marker remembers how far the monitor got, so the next prompt does not repeat them.
 */
export type ChangeFocus = {
    keys: string[];
    pushOnly?: boolean;
};
/** True when a change line names one of the keys (a ticket, its PR "(KEY)", a Slack thread title). */
export declare function concerns(line: string, keys: string[]): boolean;
/**
 * Re-exports what changed in Jira or Confluence since the local copy: exported tickets whose
 * `updated` moved, open tickets assigned to me (and `--jql` matches) not yet exported, and exported
 * Confluence pages with a newer version. Each change is printed and appended to CHANGES.md.
 */
export declare function runWatch(opts: WatchOptions): Promise<void>;
export {};
//# sourceMappingURL=watch.d.ts.map