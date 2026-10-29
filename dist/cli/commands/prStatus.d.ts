export type PrStatusOptions = {
    repo?: string;
    wait?: boolean;
    interval?: string;
    timeout?: string;
    logLines?: string;
};
/** Runs `gh` in `cwd` and returns stdout. */
export type Gh = (cwd: string, args: string[]) => string;
type RollupItem = {
    __typename?: string;
    name?: string;
    context?: string;
    workflowName?: string;
    status?: string;
    conclusion?: string;
    state?: string;
    detailsUrl?: string;
    targetUrl?: string;
    startedAt?: string;
};
type Review = {
    author: {
        login: string;
    };
    state: string;
    submittedAt: string;
};
type Comment = {
    author: {
        login: string;
    };
    body: string;
    createdAt: string;
    url?: string;
};
type Thread = {
    isResolved: boolean;
    isOutdated: boolean;
    path: string;
    line: number | null;
    first: Comment;
    last: Comment;
    count: number;
};
export type Check = {
    name: string;
    bucket: 'fail' | 'pending' | 'pass' | 'skip';
    url?: string;
};
export type PrState = {
    number: number;
    title: string;
    url: string;
    state: string;
    isDraft: boolean;
    mergeable: string;
    reviewDecision: string;
    headRefName: string;
    baseRefName: string;
    headRefOid: string;
    lastPush?: string;
    me: string;
    checks: Check[];
    reviews: Review[];
    threads: Thread[];
    comments: Comment[];
};
/** Maps a statusCheckRollup entry (CheckRun or StatusContext) to pass/fail/pending/skip. */
export declare function toCheck(item: RollupItem): Check;
/** The rollup lists every run of a re-run check; keep the latest per workflow and name. */
export declare function latestRuns(items: RollupItem[]): RollupItem[];
/** The Actions job id in a check's details URL (…/actions/runs/1/job/2). */
export declare function jobIdFromUrl(url: string | undefined): string | undefined;
/**
 * The informative lines of `gh run view --job <id> --log-failed`: prefixes, colours and echoed
 * script lines stripped, then error/failure lines with one line of context, else the tail.
 */
export declare function digestLog(log: string, max?: number): string[];
declare const defaultGh: Gh;
/** Reads a PR (number, or the current branch's PR when omitted) with its checks, reviews and review threads. */
export declare function fetchPrState(gh: Gh, cwd: string, pr?: string): PrState;
/** Unresolved threads whose last word is not mine: the reviewer is waiting for an answer or a fix. */
export declare const threadsAwaitingMe: (s: PrState) => Thread[];
/** Renders the PR state as compact markdown; failed jobs get their log digest from `logFor`. */
export declare function renderPrStatus(s: PrState, logFor: (jobId: string) => string[]): string;
/**
 * Prints a PR's CI checks (failed jobs with the relevant log lines), reviews and unresolved review
 * threads. With --wait, polls until no check is pending and exits 1 when one failed.
 */
export declare function runPrStatus(pr: string | undefined, opts: PrStatusOptions, gh?: Gh): Promise<void>;
/** One line per open PR of mine, for `watch`: compact state compared between runs. */
export type PrSnapshot = {
    number: number;
    title: string;
    url?: string;
    sig?: string;
    key?: string;
    head: string;
    failed: string[];
    pending: number;
    reviews: Record<string, string>;
    awaiting: number;
    comments: number;
};
export declare function snapshotOf(s: PrState): PrSnapshot;
/** What changed for one PR between two watch runs, as a CHANGES.md line (undefined when nothing did). */
export declare function describePrChange(prev: PrSnapshot | undefined, cur: PrSnapshot): string | undefined;
/** Head commit plus each check's bucket: changes on a push and whenever a check starts or finishes. */
export declare function checksSignature(head: string, rollup: RollupItem[]): string;
/** My open PRs in the repo at `cwd` with their checks signature, in one call. */
export declare function myOpenPrs(gh: Gh, cwd: string): Array<{
    number: number;
    sig: string;
}>;
/** Splits `gh api -i` output into status, headers and body. */
export declare function parseHttp(raw: string): {
    status: number;
    headers: Record<string, string>;
    body: string;
};
/**
 * PRs in the repo of `cwd` with a GitHub notification (review, comment, CI activity, …) since the
 * previous call. Sends If-Modified-Since, so a quiet poll is a 304 that costs no rate limit.
 * `prs` is undefined when the call failed and the caller should refresh everything.
 */
export declare function notifiedPrs(gh: Gh, cwd: string, repo: string, lastModified: string | undefined, since: string | undefined): {
    prs?: number[];
    lastModified?: string;
};
/** `owner/name` of the repo at `cwd`. */
export declare const repoSlug: (gh: Gh, cwd: string) => string;
/**
 * Shows a Windows toast (no-op elsewhere); clicking it opens `url`. Uses Windows PowerShell, which
 * still has the WinRT notification API, under PowerShell's own app id.
 */
export declare function toast(title: string, lines: string[], url?: string): void;
export { defaultGh };
//# sourceMappingURL=prStatus.d.ts.map