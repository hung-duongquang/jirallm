export type UsersOptions = {
    query: string;
    org?: string;
    project?: string;
    issue?: string;
    limit?: string;
    json?: boolean;
};
export declare function runUsers(opts: UsersOptions): Promise<void>;
//# sourceMappingURL=users.d.ts.map