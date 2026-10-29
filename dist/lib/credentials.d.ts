export declare function getToken(orgName: string): Promise<string | undefined>;
export declare function getTokenSource(orgName: string): Promise<'keychain' | 'env' | null>;
export declare function setToken(orgName: string, token: string): Promise<void>;
export declare function removeToken(orgName: string): Promise<boolean>;
export declare function hasStoredToken(orgName: string): Promise<boolean>;
export declare const __test: {
    resetKeytarCache: () => void;
};
//# sourceMappingURL=credentials.d.ts.map