import type { JiraTaskData } from '../../lib/jiraClient.js';
import type { JiraADFDocument } from '../../lib/adfToMarkdown.js';
export type SearchOptions = {
    jql: string;
    org?: string;
    limit?: string;
    cursor?: string;
    nextPageToken?: string;
    fields?: string;
    descriptionFormat?: string;
    json?: boolean;
    format?: string;
    all?: boolean;
    max?: string;
};
/** One TSV cell: objects collapse to their most human identifier, so a row stays one line. */
export declare function tsvCell(value: unknown): string;
export declare function toTsv(rows: readonly SearchRow[]): string;
export type SearchRow = Partial<Omit<JiraTaskData, 'key' | 'title'>> & {
    key: string;
    summary: string;
    descriptionAdf?: JiraADFDocument;
} & Record<string, unknown>;
export declare function runSearch(opts: SearchOptions): Promise<void>;
//# sourceMappingURL=search.d.ts.map