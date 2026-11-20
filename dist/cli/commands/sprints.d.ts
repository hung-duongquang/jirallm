export type SprintsOptions = {
    boardId: string;
    org: string;
    state?: 'active' | 'future' | 'closed';
    limit?: string;
    startAt?: string;
    json?: boolean;
};
export declare function runSprints(opts: SprintsOptions): Promise<void>;
//# sourceMappingURL=sprints.d.ts.map