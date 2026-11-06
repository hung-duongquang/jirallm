export type QaInitOptions = {
    org?: string;
    outputDir?: string;
    env?: string;
    api?: string;
    template?: string;
    force?: boolean;
};
export declare function runQaInit(issueKeyArg: string, opts: QaInitOptions): Promise<void>;
export type QaResultOptions = {
    outputDir?: string;
    note?: string;
    evidence?: string[];
};
export declare function runQaResult(issueKey: string, caseId: string, verdict: string, opts: QaResultOptions): void;
export type QaImportOptions = {
    outputDir?: string;
    grep?: string;
    layer?: string;
    reportDir?: string;
};
export declare function runQaImport(issueKey: string, json: string, opts: QaImportOptions): void;
export type QaPublishOptions = {
    org?: string;
    outputDir?: string;
    space?: string;
    parent?: string;
    site?: string;
    dryRun?: boolean;
    link?: boolean;
};
export declare function runQaPublish(issueKeyArg: string, opts: QaPublishOptions): Promise<void>;
//# sourceMappingURL=qa.d.ts.map