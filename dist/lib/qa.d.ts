import type { ResolvedProfile } from './config.js';
import { countCases, type QaReport, type Verdict } from './qaReport.js';
/**
 * The tester workflow shared by `jirallm qa …` and the web UI. The report lives next to the
 * exported ticket: <outputDir>/<key>/test-report.md, evidence in <outputDir>/<key>/test-report/.
 */
export declare function qaPaths(outputDir: string, issueKey: string): {
    dir: string;
    taskMd: string;
    report: string;
    evidence: string;
};
export type PublishedPage = {
    site: string;
    pageId: string;
};
export type LoadedReport = {
    report: QaReport;
    page?: PublishedPage;
    evidenceFiles: string[];
};
export declare function loadReport(outputDir: string, issueKey: string): LoadedReport | undefined;
export declare function saveReport(outputDir: string, issueKey: string, report: QaReport, page?: PublishedPage): string;
export declare function qaInit(profile: ResolvedProfile, issueKey: string, opts: {
    outputDir: string;
    env?: string;
    api?: string;
    template?: string;
    force?: boolean;
}): Promise<{
    path: string;
    caseCount: number;
}>;
/** Evidence names are prefixed with the key and case, like the testers' own uploads. */
export declare function evidenceName(issueKey: string, caseId: string, file: string): string;
export declare function qaRecordResult(outputDir: string, issueKey: string, caseId: string, verdict: Verdict, opts?: {
    note?: string;
    files?: Array<{
        name: string;
        data: Buffer;
    }>;
}): {
    counts: ReturnType<typeof countCases>;
    evidence: string[];
};
export type ImportSummary = {
    created: string[];
    updated: string[];
    counts: ReturnType<typeof countCases>;
    evidence: number;
};
/**
 * Records a Playwright run in the report: each test becomes a case (matched on its title, so a re-run
 * updates the same case), with its steps, verdict and screenshots. Cases written by hand are kept.
 */
export declare function qaImportPlaywright(outputDir: string, issueKey: string, playwrightJson: string, opts?: {
    grep?: string;
    layer?: string;
    reportDir?: string;
}): ImportSummary;
export type PublishPlan = {
    action: 'create' | 'update';
    site: string;
    title: string;
    space?: string;
    pageId?: string;
    counts: ReturnType<typeof countCases>;
    evidenceFiles: string[];
    link: boolean;
};
export type PublishResult = PublishPlan & {
    url: string;
    version: number;
    pageId: string;
};
export declare function qaPublish(profile: ResolvedProfile, issueKey: string, opts: {
    outputDir: string;
    space?: string;
    parent?: string;
    site?: string;
    link?: boolean;
    dryRun?: boolean;
}): Promise<PublishPlan | PublishResult>;
//# sourceMappingURL=qa.d.ts.map