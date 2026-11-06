export type CommentOptions = {
    file?: string;
    text?: string;
    org?: string;
    maxChars?: string;
    noWiki?: boolean;
    dryRun?: boolean;
    replyTo?: string;
    noThread?: boolean;
    attach?: string[];
    attachImages?: string[];
    attachMedia?: string[];
    imageLayout?: string;
    imageWidth?: string;
    json?: boolean;
};
export type DeleteCommentOptions = {
    org?: string;
    dryRun?: boolean;
    yes?: boolean;
    json?: boolean;
};
export type CommentListOptions = {
    org?: string;
    json?: boolean;
    rendered?: boolean;
};
export type EditCommentOptions = {
    file?: string;
    text?: string;
    org?: string;
    noWiki?: boolean;
    attach?: string[];
    attachImages?: string[];
    attachMedia?: string[];
    imageLayout?: string;
    imageWidth?: string;
    dryRun?: boolean;
    json?: boolean;
};
export declare function runComment(issueKeyArg: string, opts: CommentOptions): Promise<void>;
export declare function runCommentList(issueKeyArg: string, opts: CommentListOptions): Promise<void>;
export declare function runEditComment(issueKeyArg: string, commentId: string, opts: EditCommentOptions): Promise<void>;
export declare function runDeleteComment(issueKeyArg: string, commentId: string, opts: DeleteCommentOptions): Promise<void>;
//# sourceMappingURL=comment.d.ts.map