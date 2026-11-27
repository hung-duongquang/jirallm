export declare const INSECURE_HTTP_ENV: "JIRALLM_ALLOW_INSECURE_HTTP";
export type BaseUrlOptions = {
    allowInsecureHttp?: boolean;
};
export declare function isInsecureHttpAllowed(env?: NodeJS.ProcessEnv): boolean;
export declare function baseUrlProblem(raw: string, options?: BaseUrlOptions): string | undefined;
export declare function assertSecureBaseUrl(raw: string, options?: BaseUrlOptions): void;
export declare function isSameOrigin(candidate: string, baseUrl: string): boolean;
//# sourceMappingURL=baseUrl.d.ts.map