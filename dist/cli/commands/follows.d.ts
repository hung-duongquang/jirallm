export declare const RETIRE_AFTER_MS = 3600000;
/** Follow items whose PR, run or "below" window is finished, from watch's state files in `outputDir`. */
export declare function finishedItems(outputDir: string): string[];
/**
 * Drops finished items from all sessions' follows once they have been finished for RETIRE_AFTER_MS
 * (first seen finished: .retired.json in the sessions folder). Returns "<session>: <item>" per removal.
 */
export declare function retireFollows(finished: string[], sessionsDir?: string, now?: number): string[];
/**
 * The follow items a user's words name: a Slack message link (its thread and the channel below it),
 * a PR or Actions run link, "PR #12" / "#12", or an item as `jirallm unfollow --list` shows it.
 */
export declare function itemsNamed(target: string): string[];
/** Drops what `targets` name from the session's follows; returns what it removed and what is left. */
export declare function unfollow(session: string, targets: string[], sessionsDir?: string): {
    removed: string[];
    left: string[];
};
export declare function followList(session: string, sessionsDir?: string): string[];
/** `jirallm unfollow [targets...] [--session <id>] [--list]`. */
export declare function runUnfollow(targets: string[], opts: {
    session?: string;
    list?: boolean;
}, sessionsDir?: string): void;
//# sourceMappingURL=follows.d.ts.map