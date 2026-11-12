export type StateOptions = {
    outputDir?: string;
    repo?: string;
    notes?: string;
};
export type NoteOptions = {
    outputDir?: string;
};
/** Runs git in `cwd` and returns stdout ('' on failure: the card is best effort). */
export type Git = (cwd: string, args: string[]) => string;
export declare const NOTES_FILE = "notes.md";
/** Scalar frontmatter values and the first heading of an exported task.md. */
export declare function readTask(file: string): {
    fields: Record<string, string>;
    title?: string;
} | undefined;
/** Worktrees (path, branch) whose branch carries `key`, from `git worktree list --porcelain`. */
export declare function worktreesFor(porcelain: string, key: string): Array<{
    path: string;
    branch: string;
}>;
/**
 * A compact, local-only card for one ticket: the exported Jira fields, my open PRs for it (from the
 * watch state), its worktrees, the files I keep next to the export, and the notes kept with
 * `jirallm note`. No network calls, so it is cheap enough for a prompt hook.
 */
export declare function ticketState(key: string, outputDir: string, repo: string | undefined, git?: Git): string;
export declare function runState(rawKeys: string[], opts: StateOptions, git?: Git): void;
/** The line `note` appends: a dated list item, one line. */
export declare function noteLine(text: string, now?: Date): string;
/** Appends a dated line to the ticket's notes.md (local, never sent to Jira). */
export declare function runNote(rawKey: string, words: string[], opts: NoteOptions): void;
//# sourceMappingURL=state.d.ts.map