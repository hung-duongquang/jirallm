export type FetchOptions = {
    issueKey: string;
    org?: string;
    json?: boolean;
    withComments?: boolean;
    withHistory?: boolean;
    withWorklog?: boolean;
    withSubtasks?: boolean;
    withLinks?: boolean;
    withAttachments?: boolean;
    full?: boolean;
    fields?: string;
    raw?: boolean;
    rendered?: boolean;
    expand?: string;
};
export declare function runFetch(opts: FetchOptions): Promise<void>;
//# sourceMappingURL=fetch.d.ts.map