export declare const SHAREPOINT_COOKIE_ACCOUNT = "sharepoint:cookie";
export declare const SHAREPOINT_URL_ACCOUNT = "sharepoint:url";
export declare const SHAREPOINT_NOT_SET_UP = "SharePoint not set up (no session cookie): skipped. `jirallm sharepoint:auth` enables it.";
export type SharePointAuth = {
    cookie: string;
    origin: string;
};
/**
 * Takes what the user pasted from the browser — a Cookie header value, a `Cookie:` line, or a whole
 * "Copy as cURL" command — and keeps only the SharePoint session cookies (FedAuth, rtFa).
 */
export declare function parseCookieInput(input: string): string;
/** The site origin from a URL or a cURL command that contains one. */
export declare function parseOrigin(input: string): string | undefined;
export declare function hasSharePointAuth(): Promise<boolean>;
export declare function loadSharePointAuth(urlHint?: string): Promise<SharePointAuth>;
export type PageLink = {
    origin: string;
    webUrl: string;
    serverRelativePath: string;
    fileName: string;
    site: string;
};
/** Splits a modern page URL (`…/sites/<site>/SitePages/<path>.aspx`) into its web and file path. */
export declare function parseSharePointPageUrl(url: string): PageLink;
export declare class SharePointSessionError extends Error {
}
export declare class SharePointClient {
    private readonly auth;
    private readonly fetchImpl;
    constructor(auth: SharePointAuth, fetchImpl?: typeof fetch);
    get origin(): string;
    private request;
    json<T>(url: string): Promise<T>;
    download(url: string): Promise<Buffer>;
}
export type SharePointPageItem = {
    Id?: number;
    Title?: string;
    Description?: string | null;
    Modified?: string;
    FirstPublishedDate?: string | null;
    PromotedState?: number | null;
    CanvasContent1?: string | null;
    WikiField?: string | null;
    FieldValuesAsText?: {
        Author?: string;
        Editor?: string;
    };
};
export declare function fetchSharePointPage(client: SharePointClient, link: PageLink): Promise<SharePointPageItem>;
export type CanvasContext = {
    origin: string;
    /** Maps an absolute image URL to the path written in the Markdown (e.g. a downloaded copy). */
    image?: (absoluteUrl: string) => string | undefined;
};
export type CanvasResult = {
    markdown: string;
    images: string[];
};
/**
 * Converts a modern page's CanvasContent1 (text controls holding HTML, web parts holding JSON in
 * data-sp-webpartdata) to Markdown, in page order. Also accepts plain HTML (classic WikiField).
 */
export declare function canvasToMarkdown(canvasHtml: string, ctx: CanvasContext): CanvasResult;
export type RenderedSharePointPage = {
    title: string;
    markdown: string;
    images: string[];
};
export declare function renderSharePointPage(url: string, link: PageLink, item: SharePointPageItem, image?: CanvasContext['image']): RenderedSharePointPage;
export type ExportedSharePointPage = {
    dir: string;
    path: string;
    title: string;
    changed: boolean;
    imageCount: number;
    imageErrors: string[];
};
/**
 * Writes `<outputDir>/sharepoint/<site>-<page slug>/page.md` with the page's images next to it.
 * A changed page keeps the previous copy as `.page.previous.md`.
 */
export declare function exportSharePointPage(url: string, opts: {
    outputDir: string;
    images?: boolean;
    client?: SharePointClient;
}): Promise<ExportedSharePointPage>;
export type SharePointSearchHit = {
    modified: string;
    site: string;
    title: string;
    url: string;
    summary: string;
    type: string;
};
/** The KQL sent to SharePoint: pages only unless `documents`, optionally inside one site. */
export declare function sharePointQuery(query: string, opts?: {
    site?: string;
    documents?: boolean;
}): string;
/** Hit highlighting stripped; SharePoint repeats fragments, so each one is kept once. */
export declare function cleanSummary(text: string | null | undefined, width?: number): string;
export declare function searchSharePoint(client: SharePointClient, query: string, opts?: {
    site?: string;
    documents?: boolean;
    max?: number;
}): Promise<{
    kql: string;
    total: number;
    hits: SharePointSearchHit[];
}>;
//# sourceMappingURL=sharepoint.d.ts.map