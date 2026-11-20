import { type Gh } from './prStatus.js';
export declare const PR_LINK: RegExp;
export declare const REPO_PR_ITEM: RegExp;
/** The follow items (`pr/<owner>/<repo>/<n>`) of the PR links in `text`. */
export declare function prItems(text: string): string[];
/** Repo-qualified PRs (`pr/<owner>/<repo>/<n>`) that running sessions follow. */
export declare function followedRepoPrs(sessionsDir?: string): string[];
/** Splits followed PRs into numbers of the repo `slug` (prChanges reads those) and PRs of other repos. */
export declare function splitByRepo(items: string[], slug: string | undefined): {
    local: number[];
    other: string[];
};
/**
 * PR and Actions run links posted in a followed Slack thread after the session took it on ("approve
 * octopus #330 and aws #884 please" as a later reply): running sessions that follow the thread
 * (`slack/<dir>`) follow them too. Reads the local exports, which `watch` refreshes before this.
 * Ticket keys are left out: the thread's first read already picked those (at most 3).
 */
export declare function followThreadLinks(outputDir: string, sessionsDir?: string): void;
/** Changes of followed PRs in other repos since the last look (state in .repo-prs.json). */
export declare function repoPrChanges(outputDir: string, dryRun: boolean | undefined, items: string[], gh?: Gh): Array<{
    line: string;
    url?: string;
    error?: boolean;
}>;
//# sourceMappingURL=repoPrWatch.d.ts.map