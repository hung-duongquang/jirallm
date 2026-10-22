export type TransitionOptions = {
    to: string;
    org?: string;
    list?: boolean;
    dryRun?: boolean;
    json?: boolean;
};
export declare function runTransition(issueKeyArg: string, opts: TransitionOptions): Promise<void>;
//# sourceMappingURL=transition.d.ts.map