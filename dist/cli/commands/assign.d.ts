export type AssignOptions = {
    issueKey: string;
    assignee: string;
    org?: string;
    dryRun?: boolean;
    json?: boolean;
};
export declare function runAssign(opts: AssignOptions): Promise<void>;
//# sourceMappingURL=assign.d.ts.map