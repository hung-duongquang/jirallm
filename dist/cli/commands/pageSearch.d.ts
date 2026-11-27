export type PageSearchOptions = {
    org?: string;
    site?: string;
    space?: string;
    limit?: string;
    cursor?: string;
    all?: boolean;
    max?: string;
    format?: string;
    json?: boolean;
};
/**
 * Searches Confluence by CQL (or plain words) on the Jira site and every configured
 * confluence_urls site, or only on `--site`. A site without Confluence is skipped with a warning
 * when several are searched.
 */
export declare function runPageSearch(query: string, opts: PageSearchOptions): Promise<void>;
//# sourceMappingURL=pageSearch.d.ts.map