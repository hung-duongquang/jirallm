import { type SlackSearchMatch } from '../../lib/slack.js';
export type CatchupOptions = {
    since?: string;
    outputDir?: string;
    /** Repo the PRs and worktrees are read from (default: ./zorgdeclaraties when there, else the cwd). */
    repo?: string;
    mail?: boolean;
    slack?: boolean;
    jira?: boolean;
    github?: boolean;
    /** Print only, no file. */
    print?: boolean;
};
type Section = {
    title: string;
    lines: string[];
};
/**
 * `--since`: "4d" / "36h", a day (YYYY-MM-DD, local midnight) or a local time ("YYYY-MM-DD HH:MM").
 * Without it: the user's last prompt before the latest gap of 8 hours or more (the plugin keeps each
 * session's last prompt in <tmp>/jirallm-sessions/<id>.last), else 24 hours ago.
 */
export declare function resolveSince(value: string | undefined, sessionsDir: string, now?: number): number;
/** The newest activity before the newest gap of AWAY_GAP_MS (counting the gap up to now). */
export declare function lastActiveBeforeGap(times: number[], now: number): number | undefined;
/** Local "Thu 20 Nov 10:04". */
export declare function when(ms: number): string;
type Rollup = Array<{
    conclusion?: string;
    state?: string;
    status?: string;
}>;
/** "CI failed (2)", "CI running", "CI green" or "no CI". */
export declare function ciState(rollup: Rollup | null | undefined): string;
/**
 * Slack since, not the user's own messages: each thread that tags the user is one line (its newest
 * tag), first; other direct messages are one line per conversation (people chat in a DM or group DM
 * without threads), with how many more messages it had.
 */
export declare function slackLines(matches: SlackSearchMatch[], me: string, since: number): string[];
export type Mail = {
    subject: string;
    from: string;
    received: string;
    unread: boolean;
    important: boolean;
    flagged: boolean;
    toMe: boolean;
    preview: string;
};
export type Meeting = {
    subject: string;
    start: string;
    end: string;
    location: string;
    allDay: boolean;
};
/**
 * The tool a notification comes from. GitHub and Jira send mail under the name of the person who
 * acted ("Anne Erdtsieck-Wijnen" for her PR comment), so the subject tells them apart, not the sender.
 */
export declare function mailTool(m: Pick<Mail, 'from' | 'subject'>): string | undefined;
export declare function mailSections(mails: Mail[]): Section[];
export declare function meetingLines(meetings: Meeting[]): string[];
/** The watch's CHANGES.md since: important lines (reviews, failed CI, merges, comments, replies) listed, the rest counted. */
export declare function watchLogSection(outputDir: string, since: number): Section;
export declare function renderBrief(since: number, now: number, sections: Section[], failures: string[]): string;
export declare function runCatchup(opts?: CatchupOptions, deps?: {
    sessionsDir?: string;
    now?: number;
}): Promise<string>;
export {};
//# sourceMappingURL=catchup.d.ts.map