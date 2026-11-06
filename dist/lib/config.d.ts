import type { JiraConfig } from './jiraClient.js';
import { type RawConfig } from './configSchema.js';
import type { CustomFieldDefs, FieldSelector } from './exportFields.js';
export type VideoFramesConfig = {
    enabled?: boolean;
    fps?: number;
    quality?: number;
    maxFrames?: number;
};
export type Project = {
    key: string;
    outputDir?: string;
};
export type ExportConfig = {
    fieldSelector?: FieldSelector;
    customFieldDefs?: CustomFieldDefs;
};
export type Organization = {
    name: string;
    baseUrl: string;
    userEmail: string;
    includeSubtasks?: boolean;
    /** Confluence sites whose linked pages are exported; undefined means the Jira site. */
    confluenceUrls?: string[];
    videoFrames?: VideoFramesConfig;
    export?: ExportConfig;
    projects: Record<string, Project>;
};
export type ResolvedProfile = {
    config: JiraConfig;
    org: Organization;
    project: Project;
    apiToken: string;
};
export type OrgProfile = {
    config: JiraConfig;
    org: Organization;
    apiToken: string;
};
export type LoadProfileOptions = {
    org?: string;
    project?: string;
    configPath?: string;
};
export declare function resolveConfigPath(): string;
export declare function readConfig(path?: string): RawConfig;
export declare function writeConfig(config: RawConfig, path?: string): void;
export declare function resolveOptionalProjectKey(org: Organization, projectKey?: string): string | undefined;
export declare function listOrgs(raw?: RawConfig): string[];
export declare function findOrgsByProjectKey(projectKey: string, raw?: RawConfig): string[];
export declare function loadOrgProfile(opts?: {
    org?: string;
    configPath?: string;
}): Promise<OrgProfile>;
export declare function loadProfile(opts?: LoadProfileOptions): Promise<ResolvedProfile>;
export declare function upsertOrg(org: Organization, configPath?: string): void;
export declare function upsertProject(orgName: string, project: Project, configPath?: string): void;
export type RemoveOrgResult = {
    removed: boolean;
};
export declare function removeOrg(name: string, configPath?: string): RemoveOrgResult;
export type RemoveProjectResult = {
    removed: boolean;
};
export declare function removeProject(orgName: string, projectKey: string, configPath?: string): RemoveProjectResult;
//# sourceMappingURL=config.d.ts.map