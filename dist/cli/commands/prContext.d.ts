import { type JiraComment } from '../../lib/jiraClient.js';
/**
 * The local clone `--repo` names, as an absolute path. git and gh run in it, and a folder that does not
 * exist made them fail with a bare "spawnSync gh ENOENT" (Windows reports the missing cwd as a missing
 * program), which reads as gh not being installed. "owner/name" is the usual mix-up.
 */
export declare function repoDir(repo?: string): string;
export type PrContextOptions = {
    org?: string;
    repo?: string;
    base?: string;
    since?: string;
    outputDir?: string;
    export?: boolean;
};
export type PrContextDeps = {
    git: (repo: string, args: string[]) => string;
    exportIssue: (issueKey: string, outputDir: string) => void;
};
type History = {
    author: {
        displayName: string;
    };
    created: string;
    items: Array<{
        field: string;
        fromString: string | null;
        toString: string | null;
    }>;
};
type Commit = {
    hash: string;
    date: string;
    subject: string;
};
/** The issue key in a branch name such as feature/ZOD-3825-held-credit. */
export declare function keyFromBranch(branch: string): string | undefined;
/** Lines removed from and added to a long text value (description, acceptance criteria). */
export declare function lineDiff(from: string, to: string, max?: number): string[];
/** Jira history and comments after `since`, oldest first, as markdown list lines. */
export declare function jiraEventsSince(histories: History[], comments: JiraComment[], since: number | undefined, toMarkdown: (body: JiraComment['body']) => string): string[];
/** When work started: the first branch commit, else the last move to In Progress. */
export declare function workStart(commits: Commit[], histories: History[]): {
    at: number;
    why: string;
} | undefined;
export declare function runPrContext(issueKeyArg: string | undefined, opts: PrContextOptions, deps?: PrContextDeps): Promise<void>;
export {};
//# sourceMappingURL=prContext.d.ts.map