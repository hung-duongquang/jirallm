import { type SlackClient } from '../../lib/slack.js';
export declare const TAGS_FILE = ".slack-tags.json";
/** A Slack export folder: <channel id>-<thread ts without the dot>. */
export declare const SLACK_DIR: RegExp;
export type SlackTag = {
    /** Export folder under slack/. */
    dir: string;
    url: string;
    from: string;
    where: string;
    text: string;
    /** ts of the newest message in the thread that tags the user. */
    ts: string;
    /** When a session was started on it (`slack:handle`), or it was dismissed. */
    handledAt?: string;
    dismissed?: boolean;
};
type TagsState = {
    me?: string;
    since?: string;
    tags: SlackTag[];
};
export declare function readTags(outputDir: string): TagsState;
export type TagChange = {
    line: string;
    url?: string;
    error?: boolean;
    tag?: SlackTag;
};
/**
 * One round: messages since the last round that tag the user, not written by them. A thread a
 * running session follows is left to it (the thread watch hands it the new reply). Others are
 * exported and put at the top of the inbox, unhandled again if they were handled before.
 */
export declare function slackTagChanges(outputDir: string, client: SlackClient, opts?: {
    dryRun?: boolean;
    sessionsDir?: string;
    now?: number;
    exportThread?: (url: string) => Promise<unknown>;
}): Promise<TagChange[]>;
/** Marks a tag handled or dismissed in the inbox; false when it is not there. */
export declare function markTag(outputDir: string, dir: string, how: 'handled' | 'dismissed'): boolean;
/** The first prompt of the session that handles a tag: the thread link (the prompt hook follows it) and the ground rules. */
export declare function handlePrompt(tag: {
    url: string;
    from: string;
    where: string;
    text: string;
}, threadFile: string): string;
/**
 * `jirallm slack:handle <folder>`: starts a new Claude session on a tagged Slack thread, in the
 * workspace (the export dir's parent), and marks the tag handled. Runs in the terminal the toast or
 * `jirallm ui` opened; Claude takes it over.
 */
export declare function runSlackHandle(dir: string, opts?: {
    outputDir?: string;
}): Promise<void>;
/**
 * Opens a terminal that runs `jirallm slack:handle <dir>` in the workspace: in VS Code through the
 * jirallm sessions extension when VS Code is there, else in a terminal window.
 */
export declare function openHandleTerminal(dir: string, outputDir: string): {
    where: 'vscode' | 'window';
    note?: string;
};
export {};
//# sourceMappingURL=slackTags.d.ts.map