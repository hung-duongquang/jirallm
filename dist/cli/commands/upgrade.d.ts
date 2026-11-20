import { fetchLatestVersion } from '../updateCheck.js';
export { fetchLatestVersion };
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
export declare function upgradeCommandFor(method: InstallMethod, source?: string): string | undefined;
/**
 * Windows: a running jirallm (a watch, `jirallm resume`, a `changes --follow`) keeps its native modules
 * loaded (the keyring; sharp before 0.40.4), and npm fails with EBUSY replacing the install. A loaded
 * file can still be moved within the drive: they go to a temp folder, and the old process keeps using
 * them. The same goes for npm's backup folders (`.jirallm-*`) a failed install left, which npm reuses;
 * those are removed once emptied of locked files.
 */
export declare function moveLockedNativeFiles(root?: string, platform?: string): number;
/** Whether the jirallm Claude Code plugin is installed (Claude Code's installed_plugins.json names it). */
export declare function pluginInstalled(home?: string): boolean;
export declare function runUpgrade(opts?: UpgradeOpts): Promise<void>;
//# sourceMappingURL=upgrade.d.ts.map