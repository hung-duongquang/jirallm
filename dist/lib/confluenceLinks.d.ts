/** A Confluence page or whiteboard a link points at. */
export type ConfluenceRef = {
    /** Site origin, e.g. `https://acme.atlassian.net`. */
    origin: string;
    kind: 'page' | 'whiteboard';
    id: string;
};
/** How a link to a Confluence item is written once its title (and maybe a local copy) is known. */
export type ResolvedConfluenceRef = {
    title: string;
    /** Relative path to the local copy; the link keeps its Confluence URL when absent. */
    path?: string;
};
/**
 * Page id of a short link (`/wiki/x/<id>`): the id's little-endian bytes in base64, with
 * `-`/`_` for `/`/`+` and the trailing `A`s (zero bytes) dropped.
 */
export declare function tinyLinkToPageId(tiny: string): string | undefined;
/**
 * Recognises Confluence Cloud page and whiteboard URLs: `/wiki/spaces/<space>/pages/<id>/…`,
 * `/wiki/pages/viewpage.action?pageId=<id>`, short links `/wiki/x/<tiny>` and
 * `/wiki/spaces/<space>/whiteboard/<id>`.
 */
export declare function parseConfluenceUrl(url: string): ConfluenceRef | undefined;
export declare const confluenceRefKey: (ref: ConfluenceRef) => string;
/**
 * Confluence items referenced in Markdown (links and bare URLs), first occurrence first,
 * each with the URL it was first linked by.
 */
export declare function collectConfluenceRefs(markdown: string): Array<ConfluenceRef & {
    url: string;
}>;
/**
 * Rewrites links and bare URLs to Confluence items that `resolve` knows: the target becomes
 * the local copy when there is one, and a link without real text (the URL itself) shows the
 * item's title. Unknown items are left alone.
 */
export declare function rewriteConfluenceLinks(markdown: string, resolve: (ref: ConfluenceRef) => ResolvedConfluenceRef | undefined): string;
//# sourceMappingURL=confluenceLinks.d.ts.map