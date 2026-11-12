export type BoardIssuesOptions = {
    board: string;
    column?: string;
    org: string;
    project?: string;
    assignee?: string;
    json?: boolean;
};
export declare function runBoardIssues(opts: BoardIssuesOptions): Promise<void>;
//# sourceMappingURL=board.d.ts.map