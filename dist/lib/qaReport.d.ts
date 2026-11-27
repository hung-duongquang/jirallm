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
    /** Cells of columns that are not one of the fields above (e.g. Test Data, Side effects), keyed by column label. */
    extra?: Record<string, string>;
};
export type CaseField = Exclude<keyof QaCase, 'extra'>;
/** The case field a column label maps to, or undefined for a free column kept in `extra`. */
export declare function columnField(label: string): CaseField | undefined;
/**
 * Report layouts the testers use, picked with `qa init --template`:
 * - default: the case table above.
 * - api: backend tickets driven by API calls or messages. A shared base message and a read-back section,
 *   and a Test Data column so each case lists only what it changes.
 * - matrix: one row per situation × action combination with its expected outcome and side effects,
 *   plus an Also-check list for invariants (idempotency, mixed selections, …).
 */
export declare const TEMPLATES: readonly ["default", "api", "matrix"];
export type Template = (typeof TEMPLATES)[number];
export type QaReport = {
    title: string;
    /** Header rows other than Results (which is computed), e.g. Ticket, Env, API. */
    header: Array<{
        label: string;
        value: string;
    }>;
    precondition: string;
    /** Sections between the precondition and the case table (base message, lookup tables, …), kept as written. */
    sections?: string;
    /** Case table column labels as written; REPORT_COLUMNS when absent. */
    columns?: string[];
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
    api?: string;
};
export declare function newReport(header: ReportHeader, scenarios: readonly AcScenario[], template?: Template): QaReport;
export declare const buildReport: (header: ReportHeader, scenarios: readonly AcScenario[], template?: Template) => string;
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