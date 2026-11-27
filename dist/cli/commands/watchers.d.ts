export type WatchersOptions = {
    issueKey: string;
    add?: string;
    rm?: string;
    org?: string;
    dryRun?: boolean;
    json?: boolean;
};
export declare function runWatchers(opts: WatchersOptions): Promise<void>;
//# sourceMappingURL=watchers.d.ts.map