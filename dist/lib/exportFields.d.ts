export declare const BUILT_IN_FIELDS: readonly ["key", "status", "issueType", "priority", "resolution", "assignee", "reporter", "creator", "createdAt", "updatedAt", "dueDate", "resolutionDate", "components", "labels", "fixVersions", "versions", "sprint", "storyPoints", "timetracking", "issueLinks", "parent", "epic", "subtasks"];
export type BuiltInField = (typeof BUILT_IN_FIELDS)[number];
export declare const BUILT_IN_FIELD_TO_JIRA_ID: Record<BuiltInField, string | null>;
export declare const JIRA_ID_TO_BUILT_IN_FIELD: Record<string, BuiltInField>;
export declare function normalizeFieldName(token: string): string;
export declare const PRESETS: {
    readonly minimal: readonly ["key", "status", "issueType", "parent", "epic", "subtasks"];
    readonly default: readonly ["key", "status", "issueType", "priority", "assignee", "reporter", "createdAt", "updatedAt", "dueDate", "components", "labels", "fixVersions", "sprint", "storyPoints", "parent", "epic", "subtasks", "issueLinks"];
    readonly all: readonly ["key", "status", "issueType", "priority", "resolution", "assignee", "reporter", "creator", "createdAt", "updatedAt", "dueDate", "resolutionDate", "components", "labels", "fixVersions", "versions", "sprint", "storyPoints", "timetracking", "issueLinks", "parent", "epic", "subtasks"];
};
export type PresetName = keyof typeof PRESETS;
export declare const FIELD_SELECTOR_MODES: readonly ["replace", "merge"];
export type FieldSelectorMode = (typeof FIELD_SELECTOR_MODES)[number];
export type FieldSelector = {
    preset?: PresetName;
    include?: string[];
    exclude?: string[];
    mode?: FieldSelectorMode;
};
export declare const CUSTOM_FIELD_TYPES: readonly ["scalar", "select", "user", "sprint", "number", "array"];
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export type CustomFieldDef = {
    id: string;
    type: CustomFieldType;
};
export type CustomFieldDefs = Record<string, CustomFieldDef>;
export type ResolvedFieldSet = {
    friendlyKeys: string[];
    jiraFieldIds: string[];
};
export declare const SEARCH_ALWAYS_FETCH: readonly ["summary", "status"];
export type SearchAlwaysFetchId = (typeof SEARCH_ALWAYS_FETCH)[number];
export declare const SEARCH_DEFAULT_KEYS: readonly ["key", "status", "assignee", "issueType", "parent"];
export type SearchDefaultKey = (typeof SEARCH_DEFAULT_KEYS)[number];
export type ResolveFieldSetOptions = {
    alwaysFetch?: readonly string[];
    defaultKeys?: readonly string[];
    passThroughUnknown?: boolean;
};
export declare function parseFieldsFlag(raw: string): FieldSelector;
export declare function deriveSelectorMode(selector: FieldSelector | undefined): FieldSelectorMode;
export declare function resolveFieldSet(selector: FieldSelector | undefined, customFieldDefs?: CustomFieldDefs, options?: ResolveFieldSetOptions): ResolvedFieldSet;
export declare function findUnknownFieldNames(selector: FieldSelector | undefined, customFieldDefs?: CustomFieldDefs): string[];
export declare function formatUnknownFieldNamesError(unknownNames: string[], customFieldDefs?: CustomFieldDefs): string;
export declare function closestFieldName(name: string, candidates: readonly string[]): string | undefined;
export declare function formatUnresolvedFieldNamesError(unresolvedNames: readonly string[], catalogNames?: readonly string[], customFieldDefs?: CustomFieldDefs): string;
export declare function hasSprintRequested(friendlyKeys: string[], customFieldDefs: CustomFieldDefs): boolean;
export declare function hasStoryPointsRequested(friendlyKeys: string[], customFieldDefs: CustomFieldDefs): boolean;
//# sourceMappingURL=exportFields.d.ts.map