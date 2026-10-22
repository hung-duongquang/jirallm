/**
 * Tester's report in the team's Confluence layout: a header table (Jira, Env, Results), a
 * precondition section and one row per test case whose last cell holds evidence + verdict.
 * Cells are markdown with `<br/>` for line breaks, exactly as they appear in the table.
 */
export declare const REPORT_COLUMNS: readonly ["ID", "Title", "Precondition", "Steps", "Expected Result", "Priority", "Type", "Automation Layer", "Dev test coverage", "**Evidence**"];
export type QaCase = {
    id: string;
    title: string;
    precondition: string;
    steps: string;
    expected: string;
    priority: string;
    type: string;
    automation: string;
    coverage: string;
    evidence: string;
};
export type QaReport = {
    title: string;
    /** Header rows other than Results (which is computed), e.g. Ticket, Env, API. */
    header: Array<{
        label: string;
        value: string;
    }>;
    precondition: string;
    cases: QaCase[];
    /** Anything after the case table, kept as written. */
    trailer: string;
};
export type Verdict = 'pass' | 'fail' | 'blocked';
export declare const NOT_RUN = "NOT RUN";
/** Splits a markdown table row on unescaped pipes. */
export declare function splitRow(line: string): string[];
/** Text a user typed (newlines, pipes) as a single table cell. */
export declare const toCell: (text: string) => string;
/** A table cell back as plain multi-line text, for editing. */
export declare const fromCell: (cell: string) => string;
export type AcScenario = {
    title: string;
    given: string;
    when: string;
    then: string;
};
/** Acceptance-criteria tables (a header with Scenario … Then) from an exported task.md. */
export declare function parseAcceptanceScenarios(taskMd: string): AcScenario[];
export declare function countCases(cases: readonly QaCase[]): {
    passed: number;
    failed: number;
    blocked: number;
    total: number;
};
export declare function renderReport(report: QaReport): string;
export declare function parseReport(markdown: string): QaReport;
export type ReportHeader = {
    issueKey: string;
    issueUrl: string;
    title: string;
    env?: string;
};
export declare function newReport(header: ReportHeader, scenarios: readonly AcScenario[]): QaReport;
export declare const buildReport: (header: ReportHeader, scenarios: readonly AcScenario[]) => string;
export declare function countResults(markdown: string): {
    passed: number;
    failed: number;
    total: number;
};
/** Evidence cell: images/files first, then the verdict and note. */
export declare function evidenceCell(verdict: Verdict, opts?: {
    note?: string;
    evidence?: readonly string[];
}): string;
/** Sets the evidence cell of one case and recomputes the Results line. */
export declare function setResult(markdown: string, caseId: string, verdict: Verdict, opts?: {
    note?: string;
    evidence?: readonly string[];
}): string;
/** Jira-wiki for Confluence's wiki→storage converter: cell line breaks and attachment images. */
export declare function reportToWiki(report: string): string;
//# sourceMappingURL=qaReport.d.ts.map