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
};
/** One line naming the thread, most telling part first: `<first line of its first message> · #channel`. */
export declare function slackTitleLine(channelName: string | undefined, title: string): string;
/**
 * Prints a Slack message with its whole thread as Markdown, or with --output-dir writes
 * <dir>/slack/<channel>-<ts>/thread.md and downloads the thread's files next to it.
 */
export declare function runSlack(url: string, opts: SlackOptions): Promise<void>;
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