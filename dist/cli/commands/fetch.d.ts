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
/**
 * With --raw, --fields is a plain comma list of Jira field IDs passed straight
 * to the API (description, issuelinks, customfield_10050, ...). Presets and
 * +add/-drop belong to the transformed view, so they are rejected here.
 */
export declare function parseRawFieldIds(list: string): string[];
export declare function runFetch(opts: FetchOptions): Promise<void>;
//# sourceMappingURL=fetch.d.ts.map