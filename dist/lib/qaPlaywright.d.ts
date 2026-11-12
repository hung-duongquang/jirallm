import type { Verdict } from './qaReport.js';
/**
 * Turns a Playwright JSON report (`--reporter=json`, or the `json` reporter's outputFile) into test
 * results: one per test, with its steps, verdict, a short note and its image attachments.
 * Only the fields used here are typed; the reporter writes many more.
 */
type PwAttachment = {
    name: string;
    contentType: string;
    path?: string;
    body?: string;
};
type PwStep = {
    title: string;
    error?: unknown;
};
type PwResult = {
    status: string;
    duration: number;
    retry?: number;
    error?: {
        message?: string;
    };
    errors?: Array<{
        message?: string;
    }>;
    attachments?: PwAttachment[];
    steps?: PwStep[];
};
type PwTest = {
    projectName?: string;
    status: string;
    annotations?: Array<{
        type: string;
        description?: string;
    }>;
    results: PwResult[];
};
type PwSpec = {
    title: string;
    file: string;
    line: number;
    tests: PwTest[];
};
type PwSuite = {
    title: string;
    file?: string;
    specs?: PwSpec[];
    suites?: PwSuite[];
};
export type PlaywrightReport = {
    suites?: PwSuite[];
};
export type PlaywrightResult = {
    title: string;
    /** Describe blocks around the test, outermost first (the file itself is left out). */
    describe: string[];
    location: string;
    steps: string[];
    annotations: string[];
    /** Report cases this test covers, from `qa-case` annotations (e.g. "GP-5, TC-03"). */
    caseRefs: string[];
    /** A skipped test (e.g. after a failure in a serial block) counts as blocked. */
    verdict: Verdict;
    note: string;
    images: Array<{
        name: string;
        path: string;
    }>;
};
export declare const QA_CASE = "qa-case";
export declare function playwrightResults(report: PlaywrightReport, grep?: RegExp): PlaywrightResult[];
export {};
//# sourceMappingURL=qaPlaywright.d.ts.map