export type WorklogOptions = {
    file?: string;
    org?: string;
    noWiki?: boolean;
    dryRun?: boolean;
    json?: boolean;
    issueKey?: string;
    duration?: string;
};
export declare function runWorklog(opts: WorklogOptions): Promise<void>;
//# sourceMappingURL=worklog.d.ts.map