export declare const HOT_MINUTES = 30;
export declare const HOT_POLL_SECONDS = 10;
/** The session's followed threads and "below" windows with activity in the last HOT_MINUTES. */
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