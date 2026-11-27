import type { CustomFieldDefs } from './exportFields.js';
import type { JiraBoard, JiraPage, JiraSprint } from './jiraClient.js';
/** The subset of JiraClient that sprint resolution needs — keeps this unit testable. */
export type SprintResolveClient = {
    detectSprintFieldId(): Promise<string | undefined>;
    listBoards(opts: {
        projectKey?: string;
        type?: 'scrum';
    }): Promise<JiraPage<JiraBoard>>;
    findBoardByName(name: string): Promise<JiraBoard>;
    listSprints(boardId: number, opts: {
        state?: 'active';
    }): Promise<JiraPage<JiraSprint>>;
};
export type SprintFieldWrite = {
    fieldId: string;
    sprintId: number | null;
};
/**
 * Resolve a `--sprint <id|active|none>` value into the Sprint field id and the value to write.
 * - numeric id → that sprint id
 * - `active` → the (single, or --board-selected) scrum board's active sprint id
 * - `none` / `null` → `null` (clears the sprint)
 * The Sprint field id comes from a configured `sprint` custom-field def, else greenhopper detection.
 */
export declare function resolveSprintFieldWrite(client: SprintResolveClient, value: string, opts: {
    projectKey: string;
    board?: string;
    customFieldDefs?: CustomFieldDefs;
}): Promise<SprintFieldWrite>;
/**
 * Merge a resolved `--sprint` write into an existing `--field` custom-field map.
 * No-op when `sprint` is undefined; `--sprint` wins over any `--field` targeting the same id.
 */
export declare function withResolvedSprint(client: SprintResolveClient, customFields: Record<string, unknown> | undefined, sprint: string | undefined, opts: {
    projectKey: string;
    board?: string;
    customFieldDefs?: CustomFieldDefs;
}): Promise<Record<string, unknown> | undefined>;
//# sourceMappingURL=sprintWrite.d.ts.map