export declare const HOT_MINUTES = 30;
export declare const HOT_POLL_SECONDS = 10;
/**
 * A followed thread quiet for longer than HOT_MINUTES but active in the last WARM_MINUTES is checked
 * every WARM_POLL_SECONDS: a reply an hour into a conversation (Trung's answer at 10:38 to a 09:31
 * message) otherwise waited for watch, up to two minutes. Checks are shared by all sessions through
 * .slack-checked.json, so each warm thread costs Slack two calls a minute at most.
 */
export declare const WARM_MINUTES = 180;
export declare const WARM_POLL_SECONDS = 30;
/** The session's followed threads with activity in the last HOT_MINUTES (or WARM_MINUTES and due), and "below" windows with activity in the last HOT_MINUTES. */
export declare function hotFollows(outputDir: string, session: string, sessionsDir?: string, now?: number): {
    threads: Set<string>;
    below: Set<string>;
};
/** `jirallm slack:hot --session <id>`: checks the session's hot threads now; prints the change lines it logged. */
export declare function runSlackHot(opts: {
    session: string;
    outputDir?: string;
}): Promise<void>;
//# sourceMappingURL=slackHot.d.ts.map