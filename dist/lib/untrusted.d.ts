export declare function isControlChar(ch: string): boolean;
export declare function stripControlChars(value: string): string;
export declare function toSingleLine(value: unknown): string;
export declare function createNonce(): string;
export declare function beginMarker(nonce: string): string;
export declare function endMarker(nonce: string): string;
export declare function wrapUntrusted(text: string, nonce: string): string;
export declare function untrustedNotice(nonce: string): string;
//# sourceMappingURL=untrusted.d.ts.map