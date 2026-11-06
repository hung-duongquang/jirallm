type ConfirmOptions = {
    yes?: boolean;
};
export declare function confirmOrAbort(message: string, opts?: ConfirmOptions): Promise<boolean>;
export declare function typedNameConfirm(expected: string, opts?: ConfirmOptions): Promise<boolean>;
export {};
//# sourceMappingURL=confirm.d.ts.map