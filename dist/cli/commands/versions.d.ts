import { type JiraVersion } from '../../lib/jiraClient.js';
export type VersionsOptions = {
    org?: string;
    project?: string;
    json?: boolean;
};
export type VersionStatus = 'archived' | 'released' | 'unreleased';
export declare function versionStatus(version: JiraVersion): VersionStatus;
export declare function runVersions(opts: VersionsOptions): Promise<void>;
//# sourceMappingURL=versions.d.ts.map