export type ResolvedUser = {
    accountId: string | null;
    displayName?: string;
};
type UserLookup = {
    accountId: string;
    displayName: string;
    emailAddress?: string;
};
type UserClient = {
    getCurrentUser(): Promise<UserLookup>;
    searchAssignableUsers(opts: {
        query: string;
        issueKey?: string;
        project?: string;
        maxResults?: number;
    }): Promise<UserLookup[]>;
    searchUsers(query: string, maxResults?: number): Promise<UserLookup[]>;
};
type ResolveOptions = {
    issueKey?: string;
    project?: string;
    allowUnassign?: boolean;
};
export declare function looksLikeAccountId(s: string): boolean;
export declare function resolveAccountId(client: UserClient, input: string, opts: ResolveOptions): Promise<ResolvedUser>;
export {};
//# sourceMappingURL=resolveUser.d.ts.map