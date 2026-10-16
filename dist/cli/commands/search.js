import { loadOrgProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { BUILT_IN_FIELDS, findUnknownFieldNames, formatUnresolvedFieldNamesError, parseFieldsFlag, resolveFieldSet, SEARCH_ALWAYS_FETCH, SEARCH_DEFAULT_KEYS, } from '../../lib/exportFields.js';
import { COMMON_EPIC_FIELDS, PROJECTABLE_FIELDS, projectIssueFields, } from '../../lib/fieldProjection.js';
import { convertADFToMarkdown } from '../../lib/adfToMarkdown.js';
import { parseDescriptionFormat } from '../../lib/descriptionFormat.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';
const PROJECTABLE_FIELD_SET = new Set(PROJECTABLE_FIELDS);
const DESCRIPTION_KEY = 'description';
const DESCRIPTION_ADF_KEY = 'descriptionAdf';
const DESCRIPTION_ROW_KEYS = new Set([DESCRIPTION_KEY, DESCRIPTION_ADF_KEY]);
const parentSuffix = (parent) => (parent?.key ? ` parent: ${parent.key}` : '');
const isPresent = (value) => {
    if (value === undefined || value === null || value === '')
        return false;
    return !(Array.isArray(value) && value.length === 0);
};
function passThroughRawFields(rawFields, selectedKeys, customFieldDefs) {
    const extras = {};
    for (const key of selectedKeys) {
        if (DESCRIPTION_ROW_KEYS.has(key))
            continue;
        if (PROJECTABLE_FIELD_SET.has(key) || key in customFieldDefs)
            continue;
        if (isPresent(rawFields[key]))
            extras[key] = rawFields[key];
    }
    return extras;
}
const ATTACHMENT_FIELD_ID = 'attachment';
const isRawAttachment = (value) => {
    if (typeof value !== 'object' || value === null)
        return false;
    if (!('id' in value) || typeof value.id !== 'string')
        return false;
    return 'filename' in value && typeof value.filename === 'string';
};
const toAttachmentMeta = ({ id, filename, content }) => ({
    id,
    filename,
    url: typeof content === 'string' ? content : undefined,
});
function attachmentMetadata(rawFields) {
    const raw = rawFields[ATTACHMENT_FIELD_ID];
    if (!Array.isArray(raw))
        return [];
    return raw.filter(isRawAttachment).map(toAttachmentMeta);
}
const isAdfLike = (value) => typeof value === 'object' && value !== null && 'content' in value && Array.isArray(value.content);
const isAdfDocument = (value) => {
    if (!isAdfLike(value))
        return false;
    if (!('type' in value) || value.type !== 'doc')
        return false;
    return 'version' in value && typeof value.version === 'number';
};
const renderAdf = (value, attachments) => convertADFToMarkdown({ version: 1, type: 'doc', ...value }, attachments);
function adfEntries(raw, format, attachments) {
    if (!isAdfDocument(raw))
        return { description: renderAdf(raw, attachments) };
    if (format === 'adf')
        return { descriptionAdf: raw };
    const description = renderAdf(raw, attachments);
    if (format === 'both')
        return { description, descriptionAdf: raw };
    return { description };
}
function descriptionEntries(raw, format, attachments) {
    if (!isPresent(raw))
        return {};
    if (typeof raw === 'string')
        return { description: raw };
    if (isAdfLike(raw))
        return adfEntries(raw, format, attachments);
    return { description: '' };
}
function formatDescriptionFormatUnusedError() {
    return ('Unused `--description-format`: the resolved field set has no `description`. `description` is ' +
        'opt-in for `search` — name it explicitly, e.g. `--fields +description`, or drop ' +
        '`--description-format`.');
}
function formatDescriptionOverriddenError() {
    return ('Conflicting field `description`: this org config maps a custom field to the key ' +
        '`description` (`[orgs.<org>.export.custom_fields]`), which shadows the built-in issue ' +
        'description, so `search` cannot render it. Rename that custom-field key in the org config ' +
        '(e.g. to `descriptionText`), then re-run.');
}
function formatDescriptionOverriddenWarning() {
    return ('Warning: this org config maps a custom field to the key `description`, which shadows the ' +
        'built-in issue description — rows carry that custom field under `customFields.description` ' +
        'and no rendered description. Rename that custom-field key in the org config to free the name.');
}
const WILDCARD_FIELD_IDS = ['*all', '*navigable'];
const WILDCARD_FIELD_ID_SET = new Set(WILDCARD_FIELD_IDS);
const includeOnly = (selector) => selector ? { ...selector, exclude: [] } : undefined;
const isCatalogEntry = (value) => {
    if (typeof value !== 'object' || value === null)
        return false;
    return 'id' in value && typeof value.id === 'string';
};
async function readFieldCatalog(client) {
    try {
        const response = await client.listFields();
        if (!Array.isArray(response))
            return { entries: [], problem: 'unexpected response shape' };
        const entries = response.filter(isCatalogEntry);
        if (entries.length === 0)
            return { entries, problem: 'it listed no usable fields' };
        return { entries };
    }
    catch (err) {
        return { entries: [], problem: err instanceof Error ? err.message : String(err) };
    }
}
const isFriendlyFieldName = (token, customFieldDefs) => {
    const lowered = token.toLowerCase();
    const names = [...BUILT_IN_FIELDS, ...Object.keys(customFieldDefs)];
    return names.some((name) => name.toLowerCase() === lowered);
};
const findIdsForAlias = (token, catalog) => {
    const lowered = token.toLowerCase();
    const byId = catalog.filter((field) => field.id.toLowerCase() === lowered);
    const matches = byId.length > 0 ? byId : catalog.filter((f) => f.name?.toLowerCase() === lowered);
    return matches.map((field) => field.id);
};
function formatAlias({ token, ids }) {
    if (ids.length === 1)
        return `"${token}" → "${ids[0]}"`;
    const quoted = ids.map((id) => `"${id}"`).join(', ');
    return `"${token}" → ${quoted} (${ids.length} fields share that name — pick one)`;
}
function formatFieldNamesNotIdsError(aliases) {
    const label = aliases.length > 1 ? 'fields' : 'field';
    const quoted = aliases.map(({ token }) => `"${token}"`).join(', ');
    const listed = aliases.map(formatAlias).join(', ');
    return (`Unknown ${label} ${quoted}. \`search\` matches raw Jira field IDs, not display names — ` +
        `pass the id instead: ${listed}.`);
}
async function assertFieldsKnownToJira(client, selector, customFieldDefs) {
    const unknown = findUnknownFieldNames(includeOnly(selector), customFieldDefs).filter((name) => !WILDCARD_FIELD_ID_SET.has(name.toLowerCase()) && name !== DESCRIPTION_KEY);
    if (unknown.length === 0)
        return;
    const { entries, problem } = await readFieldCatalog(client);
    if (problem) {
        console.warn(`Warning: could not verify --fields against this Jira instance (${problem}) — ` +
            'proceeding without checking the requested field names.');
        return;
    }
    const catalogIds = entries.map((field) => field.id);
    const unresolved = unknown.filter((name) => !catalogIds.includes(name));
    if (unresolved.length === 0)
        return;
    const aliases = unresolved
        .filter((token) => !isFriendlyFieldName(token, customFieldDefs))
        .map((token) => ({ token, ids: findIdsForAlias(token, entries) }))
        .filter(({ ids }) => ids.length > 0);
    const aliased = new Set(aliases.map(({ token }) => token));
    const unmatched = unresolved.filter((name) => !aliased.has(name));
    const messages = [
        aliases.length > 0 ? formatFieldNamesNotIdsError(aliases) : '',
        unmatched.length > 0
            ? formatUnresolvedFieldNamesError(unmatched, catalogIds, customFieldDefs)
            : '',
    ].filter(Boolean);
    throw new Error(messages.join('\n'));
}
const SUBTASKS_KEY = 'subtasks';
const isSubtasksToken = (token) => token.trim().toLowerCase() === SUBTASKS_KEY;
const isDescriptionToken = (token) => token.trim().toLowerCase() === DESCRIPTION_KEY;
const isExplicitlyIncluded = (selector, matches) => Boolean(includeOnly(selector)?.include?.some(matches));
const hasCustomOverride = (customFieldDefs, name) => Object.hasOwn(customFieldDefs, name);
function formatSubtasksUnsupportedError() {
    return ('Unsupported field `subtasks`. `search` cannot project it — a Jira search page carries no ' +
        'subtask data, and reading it would cost one extra request per row. Drop `subtasks` from ' +
        '`--fields`, or run `jirallm fetch <KEY> --with-subtasks` for a single issue.');
}
function formatSubtasksDroppedWarning(preset) {
    const source = preset ? `the \`${preset}\` preset lists` : 'the requested fields include';
    return (`Warning: ${source} \`subtasks\`, which \`search\` cannot project — ` +
        'a Jira search page carries no subtask data, so the key is omitted from the rows. Run ' +
        '`jirallm fetch <KEY> --with-subtasks` for a single issue.');
}
function assertSubtasksNotRequested(selector, customFieldDefs) {
    if (hasCustomOverride(customFieldDefs, SUBTASKS_KEY))
        return;
    if (!isExplicitlyIncluded(selector, isSubtasksToken))
        return;
    throw new Error(formatSubtasksUnsupportedError());
}
const descriptionIsOverridden = (customFieldDefs) => hasCustomOverride(customFieldDefs, DESCRIPTION_KEY);
const descriptionExplicitlyRequested = (selector, descriptionFormat) => descriptionFormat !== undefined || isExplicitlyIncluded(selector, isDescriptionToken);
function assertDescriptionNotOverridden(selector, customFieldDefs, descriptionFormat) {
    if (!descriptionIsOverridden(customFieldDefs))
        return;
    if (!descriptionExplicitlyRequested(selector, descriptionFormat))
        return;
    throw new Error(formatDescriptionOverriddenError());
}
function assertDescriptionRequested(descriptionFormat, friendlyKeys, selector) {
    if (descriptionFormat === undefined)
        return;
    if (friendlyKeys.includes(DESCRIPTION_KEY))
        return;
    if (isExplicitlyIncluded(selector, isDescriptionToken))
        return;
    throw new Error(formatDescriptionFormatUnusedError());
}
const leaksSubtasks = (names, customFieldDefs) => !hasCustomOverride(customFieldDefs, SUBTASKS_KEY) && names.some(isSubtasksToken);
const withoutSubtasks = (names, customFieldDefs) => hasCustomOverride(customFieldDefs, SUBTASKS_KEY)
    ? [...names]
    : names.filter((name) => !isSubtasksToken(name));
async function resolveProjectionContext(client, friendlyKeys, customFieldDefs) {
    const sprintFieldId = friendlyKeys.includes('sprint')
        ? customFieldDefs.sprint?.id ?? (await client.detectSprintFieldId())
        : undefined;
    const storyPointsFieldId = friendlyKeys.includes('storyPoints')
        ? customFieldDefs.storyPoints?.id ?? (await client.detectStoryPointsFieldId())
        : undefined;
    const epicFieldId = friendlyKeys.includes('epic')
        ? customFieldDefs.epic?.id ?? (await client.detectEpicLinkFieldId())
        : undefined;
    return { sprintFieldId, storyPointsFieldId, epicFieldId, customFieldDefs };
}
function epicFallbackIds(friendlyKeys, ctx) {
    if (ctx.epicFieldId)
        return [];
    if (!friendlyKeys.includes('epic'))
        return [];
    return [...COMMON_EPIC_FIELDS];
}
function withDiscoveredIds(jiraFieldIds, friendlyKeys, ctx) {
    const extra = [
        ...[ctx.sprintFieldId, ctx.storyPointsFieldId, ctx.epicFieldId].filter((id) => Boolean(id)),
        ...epicFallbackIds(friendlyKeys, ctx),
    ];
    if (extra.length === 0)
        return [...jiraFieldIds];
    return [...new Set([...jiraFieldIds, ...extra])];
}
const withAttachmentField = (jiraFieldIds, rendersDescription) => rendersDescription ? [...new Set([...jiraFieldIds, ATTACHMENT_FIELD_ID])] : [...jiraFieldIds];
function buildRow(issue, { friendlyKeys, ctx, descriptionFormat, rendersDescription }) {
    const description = rendersDescription
        ? descriptionEntries(issue.fields.description, descriptionFormat, attachmentMetadata(issue.fields))
        : {};
    const row = {
        key: issue.key,
        summary: issue.fields.summary ?? '',
        ...projectIssueFields(issue.fields, friendlyKeys, ctx),
        ...passThroughRawFields(issue.fields, friendlyKeys, ctx.customFieldDefs ?? {}),
        ...description,
    };
    if (friendlyKeys.includes('status') && row.status === undefined)
        row.status = 'Unknown';
    return row;
}
export async function runSearch(opts) {
    const descriptionFormat = parseDescriptionFormat(opts.descriptionFormat);
    const profile = await loadOrgProfile({ org: opts.org });
    const client = new JiraClient(profile.config, profile.apiToken);
    const customFieldDefs = profile.org.export?.customFieldDefs ?? {};
    const selector = opts.fields ? parseFieldsFlag(opts.fields) : undefined;
    const resolved = resolveFieldSet(selector, customFieldDefs, {
        alwaysFetch: SEARCH_ALWAYS_FETCH,
        defaultKeys: SEARCH_DEFAULT_KEYS,
        passThroughUnknown: true,
    });
    assertSubtasksNotRequested(selector, customFieldDefs);
    if (leaksSubtasks(resolved.friendlyKeys, customFieldDefs)) {
        console.warn(formatSubtasksDroppedWarning(selector?.preset));
    }
    const friendlyKeys = withoutSubtasks(resolved.friendlyKeys, customFieldDefs);
    const jiraFieldIds = withoutSubtasks(resolved.jiraFieldIds, customFieldDefs);
    assertDescriptionNotOverridden(selector, customFieldDefs, opts.descriptionFormat);
    if (descriptionIsOverridden(customFieldDefs)) {
        console.warn(formatDescriptionOverriddenWarning());
    }
    assertDescriptionRequested(opts.descriptionFormat, friendlyKeys, selector);
    await assertFieldsKnownToJira(client, selector, customFieldDefs);
    const rendersDescription = friendlyKeys.includes(DESCRIPTION_KEY) && !descriptionIsOverridden(customFieldDefs);
    const ctx = await resolveProjectionContext(client, friendlyKeys, customFieldDefs);
    const limit = opts.limit ? parseInt(opts.limit, 10) : 50;
    const page = await client.searchIssues(opts.jql, {
        fields: withAttachmentField(withDiscoveredIds(jiraFieldIds, friendlyKeys, ctx), rendersDescription),
        limit,
        nextPageToken: opts.nextPageToken || opts.cursor,
    });
    const rows = page.issues.map((issue) => buildRow({ key: issue.key, fields: issue.fields }, { friendlyKeys, ctx, descriptionFormat, rendersDescription }));
    if (shouldOutputJson(opts)) {
        printJson({ issues: rows, nextPageToken: page.nextPageToken, isLast: page.isLast });
        return;
    }
    if (rows.length === 0) {
        console.log('No matching issues.');
        return;
    }
    console.log(`${rows.length} issue(s):`);
    for (const r of rows) {
        const assignee = r.assignee ? ` [${r.assignee}]` : '';
        console.log(`  ${r.key}  ${r.summary}  (${r.status ?? 'Unknown'})${assignee}${parentSuffix(r.parent)}`);
    }
    if (!page.isLast && page.nextPageToken) {
        console.log(`\nMore results — pass --cursor ${page.nextPageToken}`);
    }
}
//# sourceMappingURL=search.js.map