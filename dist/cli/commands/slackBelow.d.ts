import { SlackClient, type SlackMessage } from '../../lib/slack.js';
export declare const BELOW_GAP_HOURS = 3;
/** Top-level messages below the link that still count as its conversation (replies in their threads keep coming). */
export declare const BELOW_MAX_MESSAGES = 6;
type Change = {
    line: string;
    url?: string;
    error?: boolean;
};
/** Export folders (`<channel>-<ts>`) whose channel below running sessions follow (`below/<dir>` in .follow). */
export declare function followedBelow(sessionsDir?: string): Set<string>;
/**
 * The messages of the conversation below `startTs` (oldest first): up to the first gap longer than
 * `gapHours` between one bit of activity and the next. A reply in a message's thread counts as activity
 * (latest_reply), so a conversation that moved into a thread keeps the window open. Returns the window
 * and its last activity.
 */
export declare function belowWindow(history: SlackMessage[], startTs: string, threadLastTs: string | undefined, gapHours?: number, maxMessages?: number): {
    messages: SlackMessage[];
    lastActivity: number;
};
/**
 * New messages below the followed links since the last look (state in .slack-below.json): one
 * conversations.history call per open window, and the branching threads only when something changed.
 * The first look only records where the conversation is (the session has just read it).
 */
export declare function belowChanges(outputDir: string, dryRun: boolean | undefined, client: SlackClient, dirs?: Set<string>, now?: number): Promise<Change[]>;
export {};
//# sourceMappingURL=slackBelow.d.ts.map