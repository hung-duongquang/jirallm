export declare const SERVER_NAME = "jirallm";
/**
 * Claude Desktop config files of this account: the classic install (%APPDATA%\Claude, macOS Application
 * Support) and the packaged Windows app (%LOCALAPPDATA%\Claude-Data\claude_<id>). Only folders that exist:
 * Desktop creates them on its first start.
 */
export declare function desktopConfigPaths(env?: NodeJS.ProcessEnv, home?: string): string[];
/** How Desktop starts the server: this Node and this install's CLI (no shell, so no .cmd shim needed). */
export declare function serverEntry(): {
    command: string;
    args: string[];
};
type Change = {
    file: string;
    action: 'added' | 'updated' | 'unchanged' | 'removed' | 'absent';
};
/** Adds (or with `remove`, drops) the jirallm server in each config, keeping everything else; backs up first. */
export declare function updateDesktopConfigs(files: string[], entry: {
    command: string;
    args: string[];
} | undefined): Change[];
export declare function runMcpInstall(opts: {
    uninstall?: boolean;
}): void;
export {};
//# sourceMappingURL=install.d.ts.map