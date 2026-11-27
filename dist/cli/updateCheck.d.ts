/** Where jirallm is installed from: the built `release` branch of our own repo (not the upstream npm package). */
export declare const RELEASE_REPO = "hung-duongquang/jirallm";
export declare const RELEASE_SOURCE = "github:hung-duongquang/jirallm#release";
/** The release branch's package.json: its `version` is the latest release. */
export declare const RELEASE_PACKAGE_JSON_URL = "https://raw.githubusercontent.com/hung-duongquang/jirallm/release/package.json";
interface UpdateState {
    lastCheck?: number;
    latest?: string;
    /** When the plugin's session-start notice last named an update (shown once a day). */
    noticedAt?: number;
}
/** Fetches the version on the release branch. Sends nothing but a plain GET. */
export declare function fetchLatestVersion(url?: string): Promise<string>;
/** True when `latest` is a higher x.y.z than `current` (pre-release suffixes ignored). */
export declare function isNewer(latest: string, current: string): boolean;
export declare function updateStatePath(): string;
export declare function writeState(state: UpdateState, path?: string): void;
export declare function updateCheckDisabled(argv?: string[], env?: NodeJS.ProcessEnv, isTTY?: boolean): boolean;
/**
 * Daily update check, like update-notifier but against our release branch: prints a notice when an
 * earlier check found a newer version, and at most once per 24 h starts a detached background process
 * that refreshes the stored latest version (so the command itself never waits on the network).
 */
export declare function checkForUpdates(currentVersion: string, now?: number): void;
/**
 * The line the Claude Code plugin shows the user at session start, or '' (`jirallm update-notice`).
 * Most use of jirallm goes through Claude and its hooks, where no terminal shows the CLI's own notice,
 * so the daily check is started from here too. A newer release is named once a day; a plugin whose
 * version differs from the CLI's (one of the two was updated alone) every time, as its hooks may call
 * commands the CLI lacks.
 */
export declare function updateNotice(current: string, pluginVersion: string | undefined, now?: number, path?: string, refresh?: (state: UpdateState, path: string, now: number) => void): string;
export {};
//# sourceMappingURL=updateCheck.d.ts.map