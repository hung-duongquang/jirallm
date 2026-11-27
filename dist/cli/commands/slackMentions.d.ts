import { SlackClient } from '../../lib/slack.js';
export type MentionChange = {
    line: string;
    url?: string;
    error?: boolean;
};
/**
 * Ticket keys of the running Claude Code sessions, each with the sessions that follow it. Only keys
 * of a project with exported tickets count ("UTF-8" in a prompt is not a ticket), as in the prompt hook.
 */
export declare function runningSessionKeys(outputDir: string, sessionsDir?: string): Map<string, string[]>;
/** Export folder of the thread a search hit belongs to ("<channel>-<thread ts without the dot>"). */
export declare function threadDirOf(permalink: string): string;
/**
 * One round: for each key of a running session, Slack messages since the last round (the first time:
 * the last 24 h), not written by the token's own user. A message in a thread that is already exported
 * is left to `slackChanges` (it reports the thread's new replies); the session only starts following it.
 */
export declare function slackMentionChanges(outputDir: string, client: SlackClient, opts?: {
    dryRun?: boolean;
    sessionsDir?: string;
    now?: number;
}): Promise<MentionChange[]>;
//# sourceMappingURL=slackMentions.d.ts.map