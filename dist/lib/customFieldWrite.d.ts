import type { CustomFieldDefs, CustomFieldType } from './exportFields.js';
/**
 * Shape a raw string value into the payload Jira expects for a write, per field type.
 * Inverse of `extractCustomFieldValue` (read side) in jiraClient.ts.
 */
export declare function formatCustomFieldWrite(type: CustomFieldType, raw: string): unknown;
export type ParsedField = {
    jiraId: string;
    shaped: unknown;
};
/**
 * Resolve a single `--field key=value` token to a Jira field id and its shaped write value.
 * Key resolution:
 *  1. Friendly name configured in customFieldDefs → use its {id, type}.
 *  2. Raw `customfield_NNNNN[:type]` → inline type, or default to `scalar`.
 *  3. Anything else → error listing configured friendly names.
 * A `key=` (empty) or `key=null` value shapes to `null`, clearing the field regardless of type.
 */
export declare function parseFieldFlag(token: string, customFieldDefs?: CustomFieldDefs): ParsedField;
/**
 * Which of the given custom-field ids are NOT on the create screen.
 *
 * Jira's create endpoint silently drops (and applies field defaults to) custom
 * fields absent from a project + issue-type create screen, whereas the edit
 * endpoint's screen includes them — so `create --field` needs this guard where
 * `edit --field` does not. Query only: the caller decides how to react.
 */
export declare function findFieldsOffCreateScreen(jiraIds: string[], createScreenFieldIds: Iterable<string>): string[];
/** Reduce a list of `--field` tokens to a merge-ready { jiraId: shapedValue } map. */
export declare function parseFieldFlags(tokens: string[] | undefined, customFieldDefs?: CustomFieldDefs): Record<string, unknown> | undefined;
//# sourceMappingURL=customFieldWrite.d.ts.map