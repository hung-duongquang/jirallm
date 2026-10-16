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
/** Read-only Confluence Cloud REST client (v2 API) for one site. */
export declare class ConfluenceClient {
    readonly origin: string;
    private readonly redirects?;
    private readonly wiki;
    private readonly authHeader;
    constructor(origin: string, userEmail: string, apiToken: string, redirects?: RedirectPolicy | undefined);
    private getJson;
    getPage(id: string): Promise<ConfluencePage>;
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