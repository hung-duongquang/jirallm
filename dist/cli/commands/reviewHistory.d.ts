import { type Gh } from './prStatus.js';
export type ReviewHistoryOptions = {
    repo?: string;
    outputDir?: string;
    write?: boolean;
};
type Author = {
    login: string;
} | null;
type GqlComment = {
    author: Author;
    body: string;
    createdAt: string;
    url: string;
};
type GqlThread = {
    isResolved: boolean;
    isOutdated: boolean;
    path: string;
    line: number | null;
    originalLine: number | null;
    comments: {
        nodes: GqlComment[];
    };
};
type GqlReview = {
    author: Author;
    state: string;
    body: string;
    submittedAt: string | null;
    commit: {
        oid: string;
    } | null;
};
type GqlCommit = {
    commit: {
        oid: string;
        messageHeadline: string;
        committedDate: string;
    };
};
export type ReviewData = {
    me: string;
    number: number;
    title: string;
    url: string;
    state: string;
    author: string;
    headRefName: string;
    headOid: string;
    reviews: GqlReview[];
    threads: GqlThread[];
    comments: GqlComment[];
    commits: GqlCommit['commit'][];
};
export declare function fetchReviewData(gh: Gh, cwd: string, pr: string): ReviewData;
export type Diffstat = {
    files: Array<{
        filename: string;
        additions: number;
        deletions: number;
    }>;
} | undefined;
/**
 * What I already said on a PR and what happened since: my reviews, every review thread I took part
 * in grouped by outcome (resolved, answered by someone else, still waiting on the author), my
 * conversation comments, the commits after my last review with the files they touched, and the
 * local notes for the ticket. Meant to be read before a re-review, so settled points are not raised
 * again and only the new work gets reviewed.
 */
export declare function renderReviewHistory(d: ReviewData, diff: Diffstat, notes: string[]): string;
export declare function runReviewHistory(pr: string, opts: ReviewHistoryOptions, gh?: Gh): void;
export {};
//# sourceMappingURL=reviewHistory.d.ts.map