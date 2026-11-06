/** Exports one Confluence page (by URL) to `<outputDir>/confluence/<id>-<slug>/page.md`. */
export declare function exportConfluencePageByUrl(url: string, opts: {
    org?: string;
    outputDir: string;
}): Promise<import("./confluence.js").ExportedPage>;
//# sourceMappingURL=pageExport.d.ts.map