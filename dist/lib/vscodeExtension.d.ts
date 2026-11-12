export declare const EXTENSION_ID = "jirallm.jirallm-sessions";
export declare function extensionVersion(dir?: string): string;
/** A zip archive (deflated entries) of name → content. */
export declare function zip(entries: Array<[string, Buffer]>): Buffer;
/** The extension as a .vsix: the files under extension/, plus the manifest VS Code reads. */
export declare function buildVsix(dir?: string): Buffer;
/** Whether this version of the extension is installed (VS Code unpacks it to <id>-<version>[-platform]). */
export declare function extensionInstalled(version?: string): boolean;
/** The `code` command line, if VS Code is installed. */
export declare function hasCodeCli(): boolean;
/** Installs (or updates) the extension; returns an error message, or '' when it is installed. */
export declare function installExtension(): string;
export declare function resumeUri(id: string, cwd: string, title: string): string;
/** Hands the link to VS Code, with no shell in between to parse the "&". */
export declare function openUri(uri: string): void;
/** Whether `vscode/` ships with this install (it does from the release package). */
export declare const extensionAvailable: () => boolean;
//# sourceMappingURL=vscodeExtension.d.ts.map