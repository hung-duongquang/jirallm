export type ParsedIssueKey = {
    org?: string;
    key: string;
    projectKey: string;
};
export declare function parseIssueKey(input: string): ParsedIssueKey;
export type ResolvedKeys = {
    org?: string;
    projectKey: string;
    keys: string[];
};
export declare function parseIssueKeyArgs(inputs: string[]): ResolvedKeys;
//# sourceMappingURL=issueKey.d.ts.map