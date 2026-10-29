export type BoardsOptions = {
    org?: string;
    project?: string;
    type?: 'scrum' | 'kanban' | 'simple';
    name?: string;
    limit?: string;
    startAt?: string;
    json?: boolean;
};
export declare function runBoards(opts: BoardsOptions): Promise<void>;
//# sourceMappingURL=boards.d.ts.map