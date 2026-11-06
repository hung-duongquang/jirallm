export type LinkOptions = {
    inwardKey: string;
    outwardKey: string;
    type: string;
    comment?: string;
    org?: string;
    dryRun?: boolean;
    json?: boolean;
};
export declare function runLink(opts: LinkOptions): Promise<void>;
export type LinkRemoveOptions = {
    linkId: string;
    to?: string;
    org?: string;
    dryRun?: boolean;
    json?: boolean;
};
export declare function runLinkRemove(opts: LinkRemoveOptions): Promise<void>;
//# sourceMappingURL=link.d.ts.map