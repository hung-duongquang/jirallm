export type AttachOptions = {
    issueKey: string;
    files: string[];
    org?: string;
    dryRun?: boolean;
    json?: boolean;
};
export declare function runAttach(opts: AttachOptions): Promise<void>;
export type AttachRemoveOptions = {
    target?: string;
    filename?: string;
    org?: string;
    dryRun?: boolean;
    json?: boolean;
};
export declare function runAttachRemove(opts: AttachRemoveOptions): Promise<void>;
//# sourceMappingURL=attach.d.ts.map