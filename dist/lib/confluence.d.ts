import { type JiraADFDocument } from './adfToMarkdown.js';
import { type ConfluenceRef } from './confluenceLinks.js';
import { type RedirectPolicy } from './jiraClient.js';
/** Folder (inside the export folder) that holds the exported Confluence pages. */
export declare const CONFLUENCE_DIR = "confluence";
export type ConfluencePage = {
    id: string;
    title: string;
    version: number;
    updatedAt?: string;
    webUrl: string;
    adf: JiraADFDocument | null;
};
export type ConfluenceAttachment = {
    fileId: string;
    title: string;
    mediaType?: string;
    /** Path relative to `<origin>/wiki`. */
    downloadLink: string;
};
/** Bare tables shrink to fit their text; stretch them to the page width (legacy and new renderer). */
export declare function stretchTables(storage: string): string;
export type ConfluenceSearchRow = {
    id: string;
    type: string;
    title: string;
    space: string;
    lastModified: string;
    url: string;
    excerpt: string;
};
export type ConfluenceSearchPage = {
    rows: ConfluenceSearchRow[];
    nextCursor?: string;
};
/**
 * Turns the command-line query into CQL: plain words become a full-text search, real CQL is kept
 * as is, and `space` adds a space filter. Attachments and comments are left out of plain searches
 * because they crowd out the pages.
 */
export declare function toCql(query: string, space?: string): string;
/** Read-only Confluence Cloud REST client (v2 API) for one site. */
export declare class ConfluenceClient {
    readonly origin: string;
    private readonly redirects?;
    private readonly wiki;
    private readonly authHeader;
    constructor(origin: string, userEmail: string, apiToken: string, redirects?: RedirectPolicy | undefined);
    private getJson;
    private send;
    /** Server-side conversion, so tables, images and links render as Confluence's own markup. */
    wikiToStorage(wiki: string): Promise<string>;
    /** Creates the page, or updates it (next version) when `pageId` is given. Returns id + web URL. */
    savePage(page: {
        pageId?: string;
        spaceKey: string;
        parentId?: string;
        title: string;
        storage: string;
    }): Promise<{
        id: string;
        url: string;
        version: number;
    }>;
    /** Turns on the page's "full width" appearance, so wide tables are not squeezed into the narrow column. */
    setFullWidth(pageId: string): Promise<void>;
    /** Uploads a file; a file with the same name becomes a new version of that attachment. */
    uploadAttachment(pageId: string, filename: string, data: Buffer): Promise<void>;
    getPage(id: string): Promise<ConfluencePage>;
    /** Current version number of each page (no bodies), 250 ids per request. Missing ids are left out. */
    pageVersions(ids: readonly string[]): Promise<Map<string, number>>;
    /** One page of a CQL search (v1 API; v2 has no search). `cursor` comes from the previous page. */
    search(cql: string, opts: {
        limit: number;
        cursor?: string;
    }): Promise<ConfluenceSearchPage>;
    getWhiteboardTitle(id: string): Promise<string>;
    listAttachments(pageId: string): Promise<ConfluenceAttachment[]>;
    downloadAttachment(downloadLink: string, outputPath: string): Promise<void>;
}
/** Lowercase, dash-separated, at most 60 characters: `ion-check-and-registrations`. */
export declare function slugify(title: string): string;
/** A filename that is valid on every OS and needs no escaping in a Markdown link. */
export declare function safeFilename(name: string): string;
/** The folder of an earlier export of this page (`<id>-<slug>`), whatever its title was then. */
export declare function findLocalPageDir(outputDir: string, pageId: string): string | undefined;
export type ExportedPage = {
    id: string;
    title: string;
    /** Folder name below `<outputDir>/confluence/`. */
    dirName: string;
    path: string;
    status: 'new' | 'changed' | 'unchanged';
    attachmentCount: number;
};
export type PageExportContext = {
    outputDir: string;
    /** Jira issues with a local copy in this run (see `linkLocalIssues`). */
    batchKeys?: string[];
    localIssueLinks?: boolean;
    /** Other Confluence items known in this run, so links between them can be local. */
    resolveRef?: (ref: ConfluenceRef) => {
        title: string;
        path?: string;
    } | undefined;
    /** Called with the items the page links to before its links are rewritten. */
    lookupRefs?: (refs: Array<ConfluenceRef & {
        url: string;
    }>) => Promise<void>;
};
/**
 * Writes a page to `<outputDir>/confluence/<id>-<slug>/page.md` with the attachments it
 * shows in `attachments/`. Attachments already on disk are not downloaded again.
 */
export declare function exportConfluencePage(client: ConfluenceClient, pageId: string, context: PageExportContext): Promise<ExportedPage>;
//# sourceMappingURL=confluence.d.ts.map