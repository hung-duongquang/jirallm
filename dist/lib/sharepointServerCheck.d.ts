import type { SharePointClient } from './sharepoint.js';
/**
 * Checks an edit against SharePoint itself rather than Office's local cache: PowerPoint's save
 * goes to the Office Document Cache and uploads in the background, so reopening the deck through
 * PowerPoint can show a change that never reached the server.
 */
/** Reads the entries of a zip (a .pptx) whose names pass `filter`, using only node:zlib. */
export declare function readZipEntries(zip: Buffer, filter: (name: string) => boolean): Map<string, Buffer>;
/** Every paragraph of text on the slides and notes of a .pptx (runs joined, `<a:br/>` as a newline). */
export declare function pptxParagraphs(pptx: Buffer): string[];
export type ServerFileInfo = {
    modified: string;
    version: string;
};
/** `https://<tenant>.sharepoint.com/sites/<site>/<library>/<file>` → its site URL and server-relative path. */
export declare function splitDocumentUrl(fullName: string): {
    site: string;
    path: string;
} | undefined;
export declare function serverFileInfo(client: SharePointClient, fullName: string): Promise<ServerFileInfo>;
export declare function downloadServerFile(client: SharePointClient, fullName: string): Promise<Buffer>;
/** What a change should have left in the deck: lines that must be there, and text that must be gone. */
export type Expectation = {
    present: string[];
    absent: string[];
};
export declare function expectations(results: {
    target: string;
    before: string;
    after: string;
}[]): Expectation[];
/** True per expectation when every present line is inside some paragraph and no absent text is. */
export declare function expectationsMet(paragraphs: string[], list: Expectation[]): boolean[];
export type ServerCheck = {
    verified: boolean[];
    info?: ServerFileInfo;
    timedOut: boolean;
};
/**
 * Polls SharePoint until its copy of the file meets every expectation, or until `timeoutMs`.
 * Content decides, not timestamps: an edit that changed nothing makes no new version but is still
 * on the server. The file is downloaded again only when the server version changes.
 */
export declare function waitForServerContent(client: SharePointClient, fullName: string, list: Expectation[], opts?: {
    timeoutMs?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
}): Promise<ServerCheck>;
//# sourceMappingURL=sharepointServerCheck.d.ts.map