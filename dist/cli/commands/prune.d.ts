export type PruneOptions = {
    org?: string;
    outputDir?: string;
    doneFor?: string;
    keep?: string[];
    dryRun?: boolean;
    yes?: boolean;
    json?: boolean;
};
export type PruneTicket = {
    key: string;
    dir: string;
    status: string;
    kept: string[];
    bytes: number;
};
export type PrunePage = {
    dir: string;
    title: string;
    kept: string[];
    bytes: number;
};
export type PrunePlan = {
    tickets: PruneTicket[];
    pages: PrunePage[];
    bytes: number;
};
export declare function sizeOf(p: string): number;
/** Exported tickets: folders with a task.md that names its key. */
export declare function exportedTickets(outputDir: string): {
    key: string;
    dir: string;
    status: string;
}[];
/**
 * Plans what to remove: the export files of the given finished tickets, and the Confluence pages
 * they reach (directly or through other pages) that no remaining ticket reaches. Pages no ticket
 * reaches at all were exported on their own and stay.
 * The user's own files in those folders (context.md, test reports, notes) are always kept.
 */
export declare function planPrune(outputDir: string, pruneKeys: Set<string>): PrunePlan;
/** Removes the export files the plan names; a folder left empty is removed too. */
export declare function applyPrune(outputDir: string, plan: PrunePlan): void;
export declare function formatBytes(n: number): string;
export declare function runPrune(opts: PruneOptions): Promise<void>;
//# sourceMappingURL=prune.d.ts.map