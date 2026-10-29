export type InstallMethod = {
    kind: 'npx';
} | {
    kind: 'homebrew';
} | {
    kind: 'npm' | 'pnpm' | 'yarn';
};
export type UpgradeOpts = {
    yes?: boolean;
    check?: boolean;
    json?: boolean;
};
export declare function detectInstallMethod(binaryPath?: string, userAgent?: string | undefined): InstallMethod;
export declare function upgradeCommandFor(method: InstallMethod, packageName: string): string | undefined;
export declare function fetchLatestVersion(packageName: string): Promise<string>;
export declare function runUpgrade(opts?: UpgradeOpts): Promise<void>;
//# sourceMappingURL=upgrade.d.ts.map