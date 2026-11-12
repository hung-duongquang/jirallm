export type StatusLineOptions = {
    outputDir?: string;
};
/**
 * What the session follows: the ticket keys its prompts named (`<id>.keys`) and the Slack threads
 * they linked (`<id>.follow`, "slack/<channel>-<ts>"), both kept by the plugin's prompt hook.
 */
export declare function sessionKeys(session: string | undefined, dir?: string): string[];
/**
 * One status-line segment for Claude Code: whether the scheduled `watch` is alive (time of its last
 * run, or how long it has been idle), the last change report handed to this session and whether a
 * Claude turn has read it, changes to the session's tickets still waiting, and other tickets' changes.
 * Empty when the workspace has no export directory.
 */
export declare function statusLine(outputDir: string, session: string | undefined, now?: number, keys?: string[]): string;
/** `jirallm status-line`: reads Claude Code's status-line JSON on stdin (session id, project dir) and prints the segment. */
export declare function runStatusLine(opts: StatusLineOptions): void;
//# sourceMappingURL=statusLine.d.ts.map