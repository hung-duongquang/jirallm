export type PagePublishOptions = {
    org?: string;
    space?: string;
    parent?: string;
    page?: string;
    title?: string;
    site?: string;
    link?: string;
    dryRun?: boolean;
};
export declare function runPagePublish(file: string, opts: PagePublishOptions): Promise<void>;
export type PageChildrenOptions = {
    org?: string;
    format?: string;
    json?: boolean;
};
export declare function runPageChildren(page: string, opts: PageChildrenOptions): Promise<void>;
//# sourceMappingURL=pagePublish.d.ts.map