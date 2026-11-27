type FormatErrorOptions = {
    json: boolean;
    debug: boolean;
};
export declare function formatError(err: unknown, { json, debug }: FormatErrorOptions): string;
export declare function reportError(err: unknown): void;
export declare function exitOnError(err: unknown): never;
export {};
//# sourceMappingURL=errors.d.ts.map