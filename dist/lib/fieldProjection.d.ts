import type { CustomFieldDefs } from './exportFields.js';
import type { JiraTaskData } from './jiraClient.js';
export declare const COMMON_EPIC_FIELDS: readonly ["customfield_10014", "customfield_10008", "customfield_10001", "customfield_10011"];
export declare const PROJECTABLE_FIELDS: readonly ["status", "issueType", "priority", "resolution", "assignee", "reporter", "creator", "createdAt", "updatedAt", "dueDate", "resolutionDate", "components", "labels", "fixVersions", "versions", "sprint", "storyPoints", "timetracking", "issueLinks", "parent", "epic"];
export type ProjectableField = (typeof PROJECTABLE_FIELDS)[number];
export type ProjectionContext = {
    sprintFieldId?: string;
    storyPointsFieldId?: string;
    epicFieldId?: string;
    customFieldDefs?: CustomFieldDefs;
};
export type EpicRef = NonNullable<JiraTaskData['epic']>;
type RawFields = Record<string, unknown>;
export declare function extractActiveSprintName(raw: unknown): string | undefined;
export declare function extractCustomFieldValue(raw: unknown, type: string): unknown;
export declare function extractEpicFromFields(fields: RawFields): EpicRef | undefined;
export declare function extractEpicFromValue(raw: unknown): EpicRef | undefined;
export declare function projectIssueFields(rawFields: RawFields, selectedKeys: readonly string[], ctx?: ProjectionContext): Partial<JiraTaskData>;
export {};
//# sourceMappingURL=fieldProjection.d.ts.map