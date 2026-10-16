type OrgsListOptions = {
    json?: boolean;
};
type OrgsRemoveOptions = {
    yes?: boolean;
    dryRun?: boolean;
};
type ProjectRemoveOptions = {
    yes?: boolean;
    dryRun?: boolean;
};
export declare function runOrgsList(opts?: OrgsListOptions): Promise<void>;
export declare function runOrgsRemove(orgName: string, opts?: OrgsRemoveOptions): Promise<void>;
export declare function runProjectRemove(orgName: string | undefined, projectKey: string, opts?: ProjectRemoveOptions): Promise<void>;
export {};
//# sourceMappingURL=orgs.d.ts.map