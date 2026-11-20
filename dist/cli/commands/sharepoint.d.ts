import { type SlideEdit } from '../../lib/sharepointOfficeEdit.js';
export type SharePointOptions = {
    outputDir?: string;
    images?: boolean;
    copy?: boolean;
    json?: boolean;
};
/**
 * Prints a SharePoint page as Markdown, or with --output-dir writes
 * <dir>/sharepoint/<site>-<page>/page.md and downloads its images next to it.
 */
export declare function runSharePoint(url: string, opts: SharePointOptions): Promise<void>;
export type SharePointEditOptions = {
    slide?: string;
    shape?: string;
    text?: string;
    notes?: string;
    find?: string;
    replace?: string;
    edits?: string;
    dryRun?: boolean;
    json?: boolean;
};
export declare function editsFromOptions(opts: SharePointEditOptions): SlideEdit[];
/** Edits a PowerPoint deck on SharePoint in place (through local PowerPoint) and prints before/after. */
export declare function runSharePointEdit(url: string, opts: SharePointEditOptions): Promise<void>;
export type SharePointSearchOptions = {
    site?: string;
    documents?: boolean;
    max?: string;
    json?: boolean;
};
/** One TSV row per hit: modified, site, title, url, summary. Open a page with `jirallm sharepoint <url>`. */
export declare function runSharePointSearch(query: string, opts: SharePointSearchOptions): Promise<void>;
export declare function runSharePointAuth(opts: {
    remove?: boolean;
    check?: boolean;
}): Promise<void>;
//# sourceMappingURL=sharepoint.d.ts.map