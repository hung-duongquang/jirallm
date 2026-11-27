export type OS = 'macos' | 'linux' | 'windows' | 'unknown';
export type PackageManager = 'brew' | 'apt' | 'dnf' | 'pacman' | 'none';
export declare function detectOS(): OS;
export declare function hasHomebrew(): Promise<boolean>;
export declare function detectPackageManager(): Promise<PackageManager>;
export declare function ffmpegInstallCommand(pm: PackageManager): string | undefined;
export declare function getFfmpegInstallHint(): Promise<string>;
export type JsPackageManager = 'npm' | 'pnpm' | 'yarn';
export declare function detectJsPackageManagerFromUserAgent(userAgent?: string | undefined): JsPackageManager;
export declare const HOMEBREW_INSTALL_CMD = "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/main/install.sh)\"";
//# sourceMappingURL=platform.d.ts.map