export type ParsedIssueKey = {
    org?: string;
    key: string;
    projectKey: string;
};
export declare function isNumericId(value: string): boolean;
export declare function parseNumericId(value: string, label: string): string;
export declare function parseIssueKey(input: string): ParsedIssueKey;
export declare function isIssueKey(input: string): boolean;
export type ResolvedKeys = {
    org?: string;
    projectKey: string;
    keys: string[];
};
export declare function parseIssueKeyArgs(inputs: string[]): ResolvedKeys;
//# sourceMappingURL=issueKey.d.ts.map