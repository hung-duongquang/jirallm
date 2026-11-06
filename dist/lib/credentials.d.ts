export declare function getToken(orgName: string): Promise<string | undefined>;
export declare function getTokenSource(orgName: string): Promise<'keychain' | 'env' | null>;
export declare function setToken(orgName: string, token: string): Promise<void>;
export declare function removeToken(orgName: string): Promise<boolean>;
export declare function hasStoredToken(orgName: string): Promise<boolean>;
export declare const __test: {
    resetKeytarCache: () => void;
};
/** Reads a non-Jira secret (e.g. `slack:token`) from the keychain, else from `envVar`. */
export declare function getSecret(account: string, envVar: string): Promise<string | undefined>;
export declare function setSecret(account: string, value: string): Promise<void>;
export declare function removeSecret(account: string): Promise<boolean>;
//# sourceMappingURL=credentials.d.ts.map