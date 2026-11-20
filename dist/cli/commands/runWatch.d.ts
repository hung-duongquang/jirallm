import { type Gh } from './prStatus.js';
export declare const RUN_LINK: RegExp;
/** The follow items (`run/<owner>/<repo>/<id>`) of the Actions run links in `text`. */
export declare function runItems(text: string): string[];
export type RunSnapshot = {
    status: string;
    conclusion?: string;
    approvals: string[];
    waitingFor: string[];
};
/** Runs that running sessions follow. */
export declare function followedRuns(sessionsDir?: string): string[];
/** What changed between two looks at a run, or undefined. */
export declare function describeRunChange(old: RunSnapshot | undefined, now: RunSnapshot, failedJobs: () => string[]): string | undefined;
/** Changes of the followed runs since the last look (state in .runs.json). */
export declare function runChanges(outputDir: string, dryRun: boolean | undefined, gh?: Gh, runs?: string[]): Array<{
    line: string;
    url?: string;
    error?: boolean;
}>;
//# sourceMappingURL=runWatch.d.ts.map