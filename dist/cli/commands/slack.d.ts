import { SlackClient, type LoadedThread } from '../../lib/slack.js';
export type SlackOptions = {
    outputDir?: string;
    files?: boolean;
    /** false (--no-channel): leave out channel messages posted outside the thread. */
    channel?: boolean;
    /** false (--no-frames): keep videos but skip extracting their frames. */
    frames?: boolean;
    json?: boolean;
    /** Only print replies after this day/time/ts (the parent is always printed). */
    since?: string;
    /** Print only `<thread title> · #channel` (the plugin's prompt hook names Claude Code sessions with it). */
    title?: boolean;
    /** Claude Code session that reads the thread (default: $CLAUDE_CODE_SESSION_ID): it follows the PRs and tickets the thread names. */
    session?: string;
};
/**
 * One line naming the thread, most telling part first: `<first line of its first message> · #channel`.
 * A group DM's channel name lists everyone (mpdm-a--b--c-1), which only pushes the title out of sight.
 */
export declare function slackTitleLine(channelName: string | undefined, title: string): string;
/**
 * A thread that opens with nothing but a ticket link is named after the ticket: "ZOD-4243 <summary>"
 * from its export when there is one, else "ZOD-4243". Otherwise two such threads both read
 * "topicushealthcare.atlassian.net/browse/…" in /resume.
 */
export declare function ticketThreadTitle(title: string, outputDir: string | undefined): string;
/**
 * Prints a Slack message with its whole thread as Markdown, or with --output-dir writes
 * <dir>/slack/<channel>-<ts>/thread.md and downloads the thread's files next to it.
 */
export declare function runSlack(url: string, opts: SlackOptions): Promise<void>;
/**
 * A Slack thread given to a session often only points at the work ("resolve the comments in this PR"
 * with the PR link in the message), and a prompt that is just the thread's link names neither. The
 * session then follows the PRs linked in the thread's messages and the tickets they name (of projects
 * with exported tickets, at most 3 new ones), as if the prompt had named them, so their CI, reviews and
 * Jira changes reach it. Channel messages outside the thread are left out: they can be unrelated.
 */
export declare function followThreadRefs(texts: string[], outputDir: string | undefined, session: string | undefined, sessionsDir?: string): void;
/**
 * The workspace's export folder: the project of this Claude Code session (its handshake in
 * jirallm-sessions holds the project dir, also when Claude works in a worktree elsewhere), else the
 * nearest `jira-export` above the current directory.
 */
export declare function workspaceOutputDir(session?: string | undefined, cwd?: string, sessionsDir?: string): string | undefined;
/**
 * After reading a thread that is exported (so `watch` follows it) and got new replies: brings the
 * export up to date and logs the change as `watch` would, so other sessions following the thread still
 * get it, but marks it read for the session that read it (CLAUDE_CODE_SESSION_ID): its monitor does
 * not hand it the replies it just read. A thread that was never exported is left alone.
 */
export declare function refreshAfterRead(loaded: LoadedThread & {
    client: SlackClient;
}, channel: boolean | undefined, outputDir?: string | undefined, session?: string | undefined): Promise<void>;
export type SlackSearchOptions = {
    after?: string;
    max?: string;
    json?: boolean;
    /** false (--no-threads): skip looking up each hit thread's reply count and newest reply. */
    threads?: boolean;
};
/**
 * Searches Slack messages and prints one TSV row per thread (newest match): date, channel, author,
 * matches in the thread, text, permalink. Open a hit with `jirallm slack <url>`.
 */
export declare function runSlackSearch(query: string, opts: SlackSearchOptions): Promise<void>;
export declare function runSlackAuth(opts: {
    remove?: boolean;
    check?: boolean;
}): Promise<void>;
//# sourceMappingURL=slack.d.ts.map