export type WatchOptions = {
    org?: string;
    outputDir?: string;
    jql?: string;
    mine?: boolean;
    pages?: boolean;
    every?: string;
    install?: string | boolean;
    uninstall?: boolean;
    dryRun?: boolean;
};
/** Reads `key: "value"` lines from a markdown file's frontmatter (top-level and one nested level). */
export declare function frontmatter(md: string): Record<string, string>;
/** One line per changed frontmatter field plus the `##` sections whose text changed. */
export declare function describeChange(previous: string | null, current: string): string;
export type ChangesOptions = {
    outputDir?: string;
    unseen?: boolean;
    max?: string;
};
/** Splits CHANGES.md into its `## <stamp>` entries, oldest first. */
export declare function changeEntries(md: string): {
    stamp: string;
    lines: string[];
}[];
/**
 * Prints the logged changes, newest last, capped at `--max` lines. With `--unseen` only entries
 * after the last `--unseen` call are printed (nothing at all when there are none), so a
 * session-start hook adds context only when something moved.
 */
export declare function runChanges(opts: ChangesOptions): void;
/**
 * Re-exports what changed in Jira or Confluence since the local copy: exported tickets whose
 * `updated` moved, open tickets assigned to me (and `--jql` matches) not yet exported, and exported
 * Confluence pages with a newer version. Each change is printed and appended to CHANGES.md.
 */
export declare function runWatch(opts: WatchOptions): Promise<void>;
//# sourceMappingURL=watch.d.ts.map