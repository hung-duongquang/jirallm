/**
 * Office documents on SharePoint (PowerPoint, Word, Excel) are read through the Office desktop
 * apps over COM: the app opens the link with the user's own Office sign-in, so no cookie is
 * needed and sharing links (`/:p:/s/<site>/<token>`) work as they are. Windows only.
 */
export type OfficeKind = 'powerpoint' | 'word' | 'excel';
export type OfficeLink = {
    url: string;
    kind: OfficeKind;
    site: string;
    fileName?: string;
};
/**
 * Recognises a link to an Office document: a sharing link (`/:p:/`, `/:w:/`, `/:x:/`), a direct
 * file path (`…/Shared Documents/x.pptx`) or a viewer link (`…/_layouts/15/Doc.aspx?…&file=x.pptx`).
 * Returns undefined for anything else (pages, folders, other hosts).
 */
export declare function parseOfficeLink(url: string): OfficeLink | undefined;
export declare function isOfficeDocumentUrl(url: string): boolean;
export type SlideShape = {
    name: string;
    paragraphs: string[];
};
export type Slide = {
    index: number;
    hidden: boolean;
    title: string;
    shapes: SlideShape[];
    tables: string[][][];
    pictures: number;
    notes: string;
};
export type WordBlock = {
    type: 'paragraph';
    level: number;
    list: boolean;
    text: string;
} | {
    type: 'table';
    rows: string[][];
};
export type Sheet = {
    name: string;
    csv: string;
    rows: number;
    columns: number;
};
export type OfficeDocument = {
    kind: 'powerpoint';
    name: string;
    slides: Slide[];
} | {
    kind: 'word';
    name: string;
    blocks: WordBlock[];
} | {
    kind: 'excel';
    name: string;
    sheets: Sheet[];
};
/**
 * Writes JSON to -Json and, with -Copy, a local copy of the file. Opens read-only without a
 * window. PowerPoint is a single instance shared with the user, so it is only closed when this
 * script started it and nothing else is open; Word and Excel get their own instance.
 */
export declare const OFFICE_EXTRACT_PS1: string;
export declare const OFFICE_NOT_SUPPORTED = "Office documents are read through the Office desktop apps (PowerPoint, Word, Excel), which needs Windows with Microsoft 365 installed and signed in.";
/** Opens the document in its Office app and returns its content; with `copyTo`, also saves a local copy there. */
export declare function extractOfficeDocument(link: OfficeLink, opts?: {
    copyTo?: string;
    timeoutMs?: number;
}): Promise<OfficeDocument>;
/** Untyped JSON as PowerShell wrote it. */
export type Raw = Record<string, unknown>;
export declare function normalizeOfficeDocument(raw: Raw): OfficeDocument;
export declare function markdownTable(rows: string[][]): string[];
/** Minimal RFC 4180 parser (quoted fields, doubled quotes, newlines inside quotes). */
export declare function parseCsv(text: string): string[][];
export declare function renderOfficeDocument(url: string, doc: OfficeDocument): string;
export type ExportedOfficeDocument = {
    dir: string;
    path: string;
    copy?: string;
    title: string;
    kind: OfficeKind;
    changed: boolean;
};
/**
 * Writes `<outputDir>/sharepoint/<site>-<file slug>/document.md` plus the original file next to it
 * (unless `copy: false`). A changed document keeps the previous copy as `.document.previous.md`.
 */
export declare function exportOfficeDocument(url: string, opts: {
    outputDir: string;
    copy?: boolean;
    extract?: typeof extractOfficeDocument;
}): Promise<ExportedOfficeDocument>;
//# sourceMappingURL=sharepointOffice.d.ts.map