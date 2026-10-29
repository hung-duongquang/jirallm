export type PageOptions = {
    org?: string;
    outputDir?: string;
};
/** Exports one Confluence page (by URL) to `<outputDir>/confluence/<id>-<slug>/page.md`. */
export declare function runPage(url: string, opts: PageOptions): Promise<void>;
//# sourceMappingURL=page.d.ts.map