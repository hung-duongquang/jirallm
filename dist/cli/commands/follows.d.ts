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
/** The session's tickets (`<session>.keys`, its changes are delivered to the session). */
export declare function ticketList(session: string, sessionsDir?: string): string[];
/**
 * Drops what `targets` name from the session's follows, and tickets ("ZOD-12", a browse link) from its
 * tickets: another session works on it, or it was only mentioned. Returns what it removed and what is left.
 */
export declare function unfollow(session: string, targets: string[], sessionsDir?: string): {
    removed: string[];
    left: string[];
};
export declare function followList(session: string, sessionsDir?: string): string[];
/**
 * The follow items `follow` adds for a target: a Slack link is its thread only (`below/<dir>` names the
 * channel below explicitly), "PR #12" the PR in the workspace repo, a PR or run link that one.
 */
export declare function itemsToFollow(target: string): string[];
/** Adds items to the session's follows; returns those that were new. */
export declare function follow(session: string, items: string[], sessionsDir?: string): string[];
/**
 * `jirallm follow <targets...>`: Claude follows something itself, e.g. the one thread below a link that
 * is still on its topic before `unfollow below/<dir>`. A Slack thread not exported yet is exported first,
 * as watch reports replies from the export.
 */
export declare function runFollow(targets: string[], opts: {
    session?: string;
    outputDir?: string;
}, sessionsDir?: string): Promise<void>;
/** `jirallm unfollow [targets...] [--session <id>] [--list]`. */
export declare function runUnfollow(targets: string[], opts: {
    session?: string;
    list?: boolean;
}, sessionsDir?: string): void;
//# sourceMappingURL=follows.d.ts.map