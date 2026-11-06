export type JiraADFContent = {
    type: string;
    content?: JiraADFContent[];
    text?: string;
    marks?: Array<{
        type: string;
        attrs?: {
            href?: string;
            [key: string]: unknown;
        };
    }>;
    attrs?: {
        id?: string;
        type?: string;
        collection?: string;
        url?: string;
        alt?: string;
        language?: string;
        level?: number;
        state?: string;
        title?: string;
        colspan?: number;
        text?: string;
        shortName?: string;
        timestamp?: string | number;
        extensionKey?: string;
        parameters?: unknown;
    };
};
export type JiraADFDocument = {
    version: number;
    type: string;
    content: JiraADFContent[];
};
/**
 * Converts a Jira ADF document to Markdown.
 *
 * When `attachments` is empty (the default), media and attachment references cannot be
 * resolved to filenames and degrade accordingly; everything else renders identically.
 *
 * Malformed input never throws: nodes that are not objects carrying a string `type`, and
 * `content` values that are not arrays, are skipped and traversal continues with siblings.
 */
export declare function convertADFToMarkdown(content: string | JiraADFDocument | null | undefined, attachments?: Array<{
    id: string;
    filename: string;
    url?: string;
}>): string;
//# sourceMappingURL=adfToMarkdown.d.ts.map