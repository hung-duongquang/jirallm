export declare const SLACK_TOKEN_ACCOUNT = "slack:token";
export declare const SLACK_COOKIE_ACCOUNT = "slack:cookie";
export type SlackLink = {
    workspace: string;
    channel: string;
    /** Timestamp of the linked message, e.g. 1793370497.363139. */
    ts: string;
    /** Parent of the thread when the link points at a reply. */
    threadTs?: string;
};
/**
 * Parses a Slack message link: https://<ws>.slack.com/archives/<channel>/p<16 digits>[?thread_ts=…].
 * The `p` id is the message ts without its dot (10 digits of seconds, 6 of microseconds).
 */
export declare function parseSlackUrl(url: string): SlackLink;
/**
 * The file id of a Slack file link (what "Copy link" on an image gives):
 * https://<ws>.slack.com/files/<user>/<F…>/<name>. Undefined for any other URL.
 */
export declare function parseSlackFileUrl(url: string): {
    workspace: string;
    fileId: string;
} | undefined;
/** Message link for a channel + ts, in the shape parseSlackUrl reads. */
export declare function slackMessageUrl(link: SlackLink): string;
type FileShare = {
    ts: string;
    thread_ts?: string;
};
export type SlackFileInfo = SlackFile & {
    shares?: {
        public?: Record<string, FileShare[]>;
        private?: Record<string, FileShare[]>;
    };
};
export type SlackFile = {
    id: string;
    name?: string;
    title?: string;
    mimetype?: string;
    url_private?: string;
    url_private_download?: string;
    permalink?: string;
};
export type SlackAttachment = {
    title?: string;
    title_link?: string;
    text?: string;
    fallback?: string;
    author_name?: string;
    from_url?: string;
};
export type SlackMessage = {
    ts: string;
    thread_ts?: string;
    user?: string;
    username?: string;
    bot_profile?: {
        name?: string;
    };
    text?: string;
    files?: SlackFile[];
    attachments?: SlackAttachment[];
    edited?: {
        ts: string;
    };
    subtype?: string;
    bot_id?: string;
    reply_count?: number;
    /** On a thread parent: ts of the newest reply. */
    latest_reply?: string;
    /** Emoji reactions: a 👍 on a question or proposal is how people agree without a reply. */
    reactions?: {
        name: string;
        users?: string[];
        count?: number;
    }[];
};
/** A reaction's emoji without its skin tone ("+1::skin-tone-2" → 👍), or ":name:" when unknown. */
export declare const reactionEmoji: (name: string) => string;
/** Who reacted to what in `messages`, as sorted "ts|emoji name|user" keys (the export keeps them to see new ones). */
export declare function reactionKeys(messages: SlackMessage[]): string[];
/** User ids of everyone who reacted, so their names can be looked up with the authors'. */
export declare const reactionUsers: (messages: SlackMessage[]) => string[];
/** Channel messages read after a thread: until this long after its last message, at most CHANNEL_MAX. */
export declare const CHANNEL_WINDOW_HOURS = 12;
export declare const CHANNEL_MAX = 15;
export type SlackSearchMatch = {
    ts: string;
    text?: string;
    user?: string;
    username?: string;
    permalink: string;
    channel?: {
        id?: string;
        name?: string;
        is_im?: boolean;
        is_mpim?: boolean;
    };
};
type SlackResponse = {
    ok: boolean;
    error?: string;
    needed?: string;
    has_more?: boolean;
    response_metadata?: {
        next_cursor?: string;
    };
};
/**
 * Newest edit of a person's message in a thread ("0" when none): the export keeps it as lastEditTs, so
 * the watcher sees an edit in the same call it asks for new replies with. Bots edit their own status
 * messages all the time, so their edits do not count.
 */
export declare function lastEditOf(messages: SlackMessage[]): string;
/** Where a 429's Retry-After is kept per Slack method, shared by every jirallm process (watch, hooks, CLI). */
export declare const SLACK_PAUSE_DIR: string;
export type SlackAuth = {
    token: string;
    cookie?: string;
};
/** Printed instead of results when no Slack token is set, so agents skip their Slack steps. */
export declare const SLACK_NOT_SET_UP = "Slack not set up (no token): skipped. `jirallm slack:auth` enables it.";
/** Whether a Slack token is stored or in the environment; no network call. */
export declare function hasSlackToken(): Promise<boolean>;
/** Token from the keychain (`jirallm slack:auth`) or JIRALLM_SLACK_TOKEN / JIRALLM_SLACK_COOKIE. */
export declare function loadSlackAuth(): Promise<SlackAuth>;
export declare class SlackClient {
    private readonly auth;
    private readonly fetchImpl;
    private readonly pauseDir;
    private readonly now;
    private readonly names;
    constructor(auth: SlackAuth, fetchImpl?: typeof fetch, pauseDir?: string | undefined, now?: () => number);
    /**
     * Calling again before a 429's Retry-After is over only earns another 429 (and can stretch the wait),
     * so until then every process skips the method without asking Slack.
     */
    private pausedUntil;
    private pause;
    private headers;
    call<T>(method: string, params: Record<string, string>): Promise<T & SlackResponse>;
    /** The whole thread around `link` (parent first), or just the message when it has no thread. */
    thread(link: SlackLink): Promise<SlackMessage[]>;
    /** Reply count and newest reply ts of the thread whose parent is `ts` (one cheap call). */
    threadInfo(channel: string, ts: string): Promise<{
        replies: number;
        latestReply?: string;
    }>;
    private replies;
    /**
     * Top-level channel messages posted after the thread parent `threadTs` up to `latest`, oldest
     * first, at most `max`: people often answer in the channel instead of in the thread. Join/leave
     * notices and "also send to channel" copies of this thread's replies are left out.
     */
    channelAfter(channel: string, threadTs: string, latest: string, max: number): Promise<SlackMessage[]>;
    /** Messages matching a Slack search query, newest first, up to `max` (search.messages, 100 per page). */
    search(query: string, max: number): Promise<{
        total: number;
        matches: SlackSearchMatch[];
    }>;
    /** Messages matching any of `queries`, each message once, newest first, up to `max`. */
    searchAny(queries: string[], max: number): Promise<{
        total: number;
        matches: SlackSearchMatch[];
    }>;
    /**
     * Message link for a Slack message or file link. A file link is resolved with files.info to the
     * first message that shares the file (the thread parent stays in thread_ts), so an image can be
     * read before anyone replies to it.
     */
    resolveLink(url: string): Promise<SlackLink>;
    channelName(channel: string): Promise<string | undefined>;
    userName(id: string): Promise<string>;
    download(file: SlackFile): Promise<Buffer>;
}
/**
 * Converts Slack mrkdwn to Markdown. Mentions are resolved with `names` (user id → name);
 * code spans and blocks are left alone.
 */
export declare function mrkdwnToMarkdown(text: string, names: Map<string, string>): string;
/** User ids mentioned as <@U…> in a message, so their names can be looked up first. */
export declare function mentionedUsers(text: string): string[];
export declare function formatTs(ts: string): string;
export type RenderInput = {
    url: string;
    channelName?: string;
    messages: SlackMessage[];
    linkedTs: string;
    names: Map<string, string>;
    /** Local path per file id, for files that were downloaded. */
    localFiles?: Map<string, string>;
    /** Folder (relative, ending in /) and frame count per video file id whose frames were extracted. */
    localFrames?: Map<string, {
        dir: string;
        count: number;
    }>;
    /** Messages after this ts arrived since the previous export; their headings say "(new)". */
    newSince?: string;
    /** Top-level channel messages posted after the thread started (see SlackClient.channelAfter). */
    channelMessages?: SlackMessage[];
    /** Only replies (and channel messages) after this Slack ts are printed; the parent always is. */
    since?: string;
};
/**
 * A `--since` value as a Slack ts: a ts itself, a day (YYYY-MM-DD, from its local midnight) or a
 * local time (YYYY-MM-DD HH:MM or YYYY-MM-DDTHH:MM).
 */
export declare function parseSince(value: string): string;
/**
 * A message's body as Markdown lines: its text, quoted attachments (link unfurls) and its files, linked
 * to the local copy when downloaded (images inline), else named with their Slack permalink. A message
 * that is only a screenshot is not left blank.
 */
export declare function messageBodyLines(msg: SlackMessage, names: Map<string, string>, localFiles?: Map<string, string>, localFrames?: Map<string, {
    dir: string;
    count: number;
}>): string[];
/** Local file name of a Slack file in an export folder. */
export declare const slackLocalFileName: (file: SlackFile) => string;
/**
 * Downloads the files of `messages` into `dir` (a file already there is kept: a Slack file id never gets
 * new content). Returns file id → "./<name>" for the ones on disk, and the errors of the rest.
 */
export declare function downloadSlackFiles(client: SlackClient, messages: SlackMessage[], dir: string): Promise<{
    localFiles: Map<string, string>;
    errors: string[];
}>;
export declare function renderThread(input: RenderInput): string;
export type ExportedSlackThread = {
    /** Folder name below `<outputDir>/slack/`. */
    dirName: string;
    path: string;
    title: string;
    messageCount: number;
    fileCount: number;
    /** Files that could not be downloaded, with the reason. */
    fileErrors: string[];
    /** Replies that arrived since the previous export (0 on the first export). */
    newReplies: number;
};
/**
 * A short title for the list: the first line of the thread's first message that is more than a
 * bare link (a thread often opens with the ticket URL), else that link; for a message that is only
 * a file (a screenshot or recording), the file's title.
 */
export declare function threadTitle(messages: SlackMessage[], names: Map<string, string>): string;
export type LoadedThread = {
    link: SlackLink;
    /** Message link of `link` (a file link is replaced by the message that shares the file). */
    url: string;
    channelName?: string;
    messages: SlackMessage[];
    /** Top-level channel messages after the thread started (empty with `channel: false`). */
    channelMessages: SlackMessage[];
    names: Map<string, string>;
};
/** Fetches the thread around `url` (message or file link), with the names of its authors and mentioned users. */
export declare function loadSlackThread(url: string, client?: SlackClient, opts?: {
    channel?: boolean;
}): Promise<LoadedThread & {
    client: SlackClient;
}>;
/** Folder of a thread below `<outputDir>/slack/`: "<channel>-<thread ts without the dot>". */
export declare function slackThreadDirName(link: SlackLink, messages: SlackMessage[]): string;
/**
 * Brings an existing export of a thread just read up to date, so `watch` does not report the
 * replies the reader has already seen as new. A thread that was never exported is left alone; one
 * read without its channel messages is not written (the export would lose them). Returns the
 * export's path when it was refreshed.
 */
export declare function refreshSlackExport(loaded: LoadedThread & {
    client: SlackClient;
}, outputDir: string, channel: boolean | undefined): Promise<ExportedSlackThread | undefined>;
/**
 * Writes `<outputDir>/slack/<channel>-<thread ts>/thread.md` and downloads the thread's files
 * next to it (unless `files` is false). Exporting the same thread again overwrites it.
 */
export declare function exportSlackThread(fileOrMessageUrl: string, opts: {
    outputDir: string;
    files?: boolean;
    client?: SlackClient;
    channel?: boolean;
    frames?: boolean;
    /** The thread as already fetched (`jirallm slack <url>` printing it), so it is not fetched twice. */
    loaded?: LoadedThread & {
        client: SlackClient;
    };
}): Promise<ExportedSlackThread>;
/**
 * Builds search.messages queries. Slack's API has no OR (all terms must match), so the query is
 * split on OR (outside quotes) into one query per alternative. Slack splits ZOD-3988 on the hyphen
 * and would match any "ZOD", so bare Jira keys are quoted; `after` (YYYY-MM-DD) includes that day:
 * Slack's after: modifier excludes its day, so the day before is passed (a re-review run with the
 * date of the last review must still see replies from later that day).
 */
export declare function slackSearchQueries(query: string, after?: string): string[];
export type SlackSearchHit = {
    date: string;
    channel: string;
    author: string;
    text: string;
    url: string;
    /** Other matches in the same thread, folded into this (newest) one. */
    more: number;
    /** Channel id and parent ts of the thread the match belongs to. */
    channelId?: string;
    threadTs?: string;
    /** Filled by slack:search: replies in that thread and when the newest arrived (it may not match). */
    replies?: number;
    lastReply?: string;
};
/**
 * One hit per thread (the newest match; its permalink opens the thread with `jirallm slack <url>`),
 * text flattened to one line of at most `width` characters.
 */
export declare function searchHits(matches: SlackSearchMatch[], names: Map<string, string>, width?: number): SlackSearchHit[];
/** The fields under `slack:` in a thread.md written by exportSlackThread. */
export declare function threadFrontmatter(text: string): Record<string, string>;
export {};
//# sourceMappingURL=slack.d.ts.map