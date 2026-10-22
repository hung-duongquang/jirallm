export type StartOptions = {
    org?: string;
    repo?: string;
    worktreeRoot?: string;
    base?: string;
    type?: string;
    slug?: string;
    status?: string;
    outputDir?: string;
    export?: boolean;
    assign?: boolean;
    transition?: boolean;
    dryRun?: boolean;
};
export type StartDeps = {
    run: (cmd: string, args: string[]) => void;
    exportIssue: (issueKey: string, outputDir: string) => void;
};
/** "BE - Journal entries overview (API)" → "be-journal-entries-overview-api" */
export declare function slugify(summary: string, maxLength?: number): string;
export declare function branchName(type: string, issueKey: string, slug: string): string;
/** Number part of the key, so ZOD-3775 lands in <root>/3775 like the existing worktrees. */
export declare function worktreePath(root: string, issueKey: string): string;
export declare function runStart(issueKeyArg: string, opts: StartOptions, deps?: StartDeps): Promise<void>;
//# sourceMappingURL=start.d.ts.map