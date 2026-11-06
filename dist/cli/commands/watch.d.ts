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
};
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
/**
 * The compact change report (header, then one line per item with the latest state), or null when
 * there is nothing to show. With `unseen` only entries after the `.changes.seen` marker count, and
 * the marker moves past them.
 */
export declare function changesReport(outputDir: string, unseen: boolean, max: number): string | null;
/**
 * Re-exports what changed in Jira or Confluence since the local copy: exported tickets whose
 * `updated` moved, open tickets assigned to me (and `--jql` matches) not yet exported, and exported
 * Confluence pages with a newer version. Each change is printed and appended to CHANGES.md.
 */
export declare function runWatch(opts: WatchOptions): Promise<void>;
export {};
//# sourceMappingURL=watch.d.ts.map