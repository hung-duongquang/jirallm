export type WorklogVisibility = {
    type: 'group' | 'role';
    value: string;
};
export type WorklogInput = {
    issueKey: string;
    startTime?: string;
    endTime?: string;
    duration?: string | number;
    description?: string;
    org?: string;
    visibility?: WorklogVisibility;
};
export type ValidatedWorklog = {
    index: number;
    issueKey: string;
    projectKey: string;
    org?: string;
    started: Date;
    durationSeconds: number;
    description?: string;
    visibility?: WorklogVisibility;
};
export type ValidationError = {
    index: number;
    message: string;
};
export declare function parseDuration(input: string | number): number;
export declare function formatStartedForJira(d: Date): string;
export declare function validateWorklog(entry: unknown, index: number): ValidatedWorklog;
export declare function validateAll(entries: unknown[]): {
    valid: ValidatedWorklog[];
    errors: ValidationError[];
};
export declare function formatDurationHuman(seconds: number): string;
//# sourceMappingURL=worklog.d.ts.map