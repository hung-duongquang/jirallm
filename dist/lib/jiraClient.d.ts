import type { CustomFieldDefs } from './exportFields.js';
import type { AdfDocument } from './adfMedia.js';
import type { JiraADFDocument } from './adfToMarkdown.js';
export type { JiraADFDocument, JiraADFContent } from './adfToMarkdown.js';
export type JiraConfig = {
    baseUrl: string;
    projectKey?: string;
    userEmail: string;
    /** Overrides for which redirects this client will follow. See {@link RedirectPolicy}. */
    redirects?: RedirectPolicy;
};
export type JiraUser = {
    accountId: string;
    displayName: string;
    emailAddress?: string;
    active?: boolean;
    accountType?: string;
};
export type JiraComment = {
    id: string;
    author: {
        displayName: string;
        accountId?: string;
    };
    created: string;
    body: string | JiraADFDocument;
    renderedBody?: string;
};
type JiraChangelogItem = {
    field: string;
    fromString: string | null;
    toString: string | null;
};
type JiraChangelogHistory = {
    id: string;
    author: {
        displayName: string;
    };
    created: string;
    items: JiraChangelogItem[];
};
type HistoryEntry = {
    type: 'comment' | 'status_change' | 'field_change';
    author: string;
    date: string;
    content: string;
    field?: string;
    id?: string;
    authorAccountId?: string;
};
export type WorklogSummary = {
    author: string;
    started: string;
    timeSpent: string;
    comment?: string;
};
export type JiraBoard = {
    id: number;
    name: string;
    type: string;
};
export type JiraBoardConfiguration = {
    columnConfig: {
        columns: Array<{
            name: string;
            statuses: Array<{
                id: string;
                self: string;
            }>;
        }>;
    };
};
export type JiraTransition = {
    id: string;
    name: string;
    to: {
        id: string;
        name: string;
    };
};
export type JqlIssue = {
    key: string;
    fields: Record<string, unknown>;
};
export type JiraSearchPage<T> = {
    issues: T[];
    nextPageToken?: string;
    isLast: boolean;
};
export type JiraProject = {
    id: string;
    key: string;
    name: string;
    projectTypeKey?: string;
    simplified?: boolean;
    style?: string;
    lead?: {
        accountId: string;
        displayName: string;
    };
};
export type JiraSprint = {
    id: number;
    self: string;
    state: 'active' | 'future' | 'closed' | string;
    name: string;
    startDate?: string;
    endDate?: string;
    completeDate?: string;
    originBoardId?: number;
    goal?: string;
};
export type JiraIssueType = {
    id: string;
    name: string;
    description?: string;
    iconUrl?: string;
    subtask: boolean;
    hierarchyLevel?: number;
};
export type JiraIssueLinkType = {
    id: string;
    name: string;
    inward: string;
    outward: string;
};
export type JiraPriority = {
    id: string;
    name: string;
    iconUrl?: string;
    description?: string;
};
export type JiraStatus = {
    id: string;
    name: string;
    description?: string;
    statusCategory?: {
        id: number;
        key: string;
        name: string;
        colorName?: string;
    };
};
export type JiraComponent = {
    id: string;
    name: string;
    description?: string;
};
export type JiraCreateField = {
    fieldId: string;
    name: string;
    required: boolean;
    schemaType?: string;
    allowedValues?: string[];
};
export type JiraWatcher = {
    accountId: string;
    displayName: string;
    active?: boolean;
};
export type UploadedAttachment = {
    id: string;
    filename: string;
    size: number;
    self?: string;
    mimeType?: string;
    created?: string;
    content?: string;
    thumbnail?: string;
    author?: {
        accountId?: string;
        displayName?: string;
        emailAddress?: string;
    };
};
export type JiraIssueLink = {
    id: string;
    self?: string;
    type: {
        id?: string;
        name: string;
        inward: string;
        outward: string;
    };
    inwardIssue?: {
        key: string;
    };
    outwardIssue?: {
        key: string;
    };
};
export type JiraPage<T> = {
    values: T[];
    startAt: number;
    maxResults: number;
    isLast: boolean;
    total?: number;
};
type SubtaskSummary = {
    key: string;
    title: string;
    status: string;
};
export type IssueLinkSummary = {
    id: string;
    type: string;
    key: string;
    title: string;
    status?: string;
};
export type ParentRef = {
    key: string;
    title: string;
    status?: string;
    issueType?: string;
    priority?: string;
};
export type TimeTrackingSummary = {
    originalEstimate?: string;
    remainingEstimate?: string;
    timeSpent?: string;
};
export type JiraTaskData = {
    key: string;
    title: string;
    status: string;
    description: string;
    issueType?: string;
    priority?: string;
    resolution?: string;
    assignee?: string;
    reporter?: string;
    creator?: string;
    createdAt?: string;
    updatedAt?: string;
    dueDate?: string;
    resolutionDate?: string;
    components?: string[];
    labels?: string[];
    fixVersions?: string[];
    versions?: string[];
    sprint?: string;
    storyPoints?: number;
    timetracking?: TimeTrackingSummary;
    issueLinks?: IssueLinkSummary[];
    parent?: ParentRef;
    epic?: {
        key: string;
        title?: string;
    };
    subtasks?: SubtaskSummary[];
    customFields?: Record<string, unknown>;
    attachments: Array<{
        id: string;
        filename: string;
        url: string;
        size: number;
    }>;
    history: HistoryEntry[];
    comments?: Array<{
        id: string;
        author: string;
        created: string;
        body: string;
    }>;
    worklogs?: WorklogSummary[];
};
export type RawIssue = {
    key: string;
    fields: Record<string, unknown>;
    names?: Record<string, string>;
    renderedFields?: Record<string, unknown>;
};
export type FetchIssueDetailsOptions = {
    jiraFieldIds?: string[];
    customFieldDefs?: CustomFieldDefs;
    includeComments?: boolean;
    includeChangelog?: boolean;
    includeWorklog?: boolean;
    includeLinks?: boolean;
    fullChangelog?: boolean;
};
type JiraFieldMeta = {
    id: string;
    name: string;
    custom: boolean;
    schema?: {
        type?: string;
        custom?: string;
        items?: string;
    };
};
export type JiraTaskSummary = {
    key: string;
    title: string;
    status: string;
    issueType?: string;
    parent?: ParentRef;
    epic?: {
        key: string;
        title?: string;
    };
    subtasks?: SubtaskSummary[];
};
export type JiraApiErrorInit = {
    status: number;
    statusText: string;
    body: string;
    headers: Record<string, string>;
    url?: string;
};
/**
 * Thrown for every non-2xx Jira response. Extends `Error` with a byte-identical
 * `message` to the plain errors this client used to throw, so string-matching
 * consumers keep working, while exposing the response data they previously had
 * no way to read — notably `retry-after` and `x-authentication-denied-reason`.
 *
 * `headers` is a plain lowercase-keyed record rather than a `Headers` instance:
 * consumers frequently bundle this package (esbuild `noExternal`) or cross an
 * ESM/CJS boundary, and a POJO survives that, structured cloning and JSON
 * serialisation, whereas a `Headers` realm mismatch does not.
 */
export declare class JiraApiError extends Error {
    /** Duck-type brand — reliable where `instanceof` is not (bundled/duplicated copies). */
    readonly isJiraApiError: true;
    readonly status: number;
    readonly statusText: string;
    readonly body: string;
    readonly headers: Record<string, string>;
    readonly errorMessages?: string[];
    readonly url?: string;
    constructor(message: string, init: JiraApiErrorInit);
    /** First message Jira itself reported, if its error body was JSON. */
    get firstErrorMessage(): string | undefined;
    /** `Retry-After` in seconds, accepting both the delta and HTTP-date forms. */
    get retryAfterSeconds(): number | undefined;
    /**
     * Atlassian's captcha challenge header — the only signal telling a user they
     * must log into Jira in a browser once before the API will answer again.
     */
    get deniedReason(): string | undefined;
    /**
     * Structural check that works across duplicated/bundled copies of this class,
     * where `instanceof` silently returns false.
     */
    static isJiraApiError(error: unknown): error is JiraApiError;
    /** Consumes the response body and builds the error with the legacy message. */
    static fromResponse(response: Response, prefix: string): Promise<JiraApiError>;
}
/** Standalone form of {@link JiraApiError.isJiraApiError}, for `import { isJiraApiError }`. */
export declare const isJiraApiError: (error: unknown) => error is JiraApiError;
/**
 * Controls which redirects this client is willing to follow. Every HTTP call
 * runs with `redirect: 'manual'` so a redirect is a decision, not a default:
 * an allowlisted Jira host that answers `302 Location: http://169.254.169.254/`
 * must not turn into a request against the caller's internal network.
 */
export type RedirectPolicy = {
    /** Hops to follow before giving up. Default {@link DEFAULT_MAX_REDIRECTS}. */
    maxRedirects?: number;
    /**
     * Hosts a redirect may point at, on top of the request's own host and the
     * built-in Atlassian list ({@link ATLASSIAN_REDIRECT_HOSTS}). Needed for Jira
     * Data Center and custom domains that redirect to a sibling host (SSO, CDN).
     * An entry starting with `.` matches that domain and its subdomains
     * (`.example.com`); anything else must match the host exactly.
     */
    allowedRedirectHosts?: string[];
};
export declare const DEFAULT_MAX_REDIRECTS = 3;
/**
 * Atlassian-owned domains a Jira Cloud request legitimately bounces to.
 * `atlassianusercontent.com` / `atl-paas.net` / `media.atlassian.com` are where
 * `/rest/api/3/attachment/content/{id}` sends attachment downloads.
 */
export declare const ATLASSIAN_REDIRECT_HOSTS: readonly [".atlassian.net", ".atlassian.com", ".jira.com", ".atl-paas.net", ".atlassianusercontent.com"];
/**
 * `fetch` with an explicit redirect policy.
 *
 * **Protects against:** a compromised or hostile Jira host bouncing the client
 * onto an unrelated origin, a scheme downgrade to `http`, a literal private /
 * loopback / link-local / CGNAT / multicast address (IPv4 and IPv6, including
 * the decimal and `::ffff:` forms the WHATWG URL parser normalises), unbounded
 * redirect chains, and credential leakage — `Authorization` and `Cookie` are
 * dropped the moment the origin changes.
 *
 * **Does NOT protect against:** DNS rebinding or a hostname that simply
 * *resolves* to a private address. The check is on the redirect target's name;
 * an allowlisted host pointing its A record at `127.0.0.1` would still be
 * dialled. Closing that requires resolve-then-pin at the socket layer (a custom
 * undici dispatcher), which is out of scope here. It also does not inspect
 * response bodies, and it does not re-validate the *initial* URL — the caller
 * still owns first-hop validation of `baseUrl`.
 */
export declare const requestWithRedirectPolicy: (input: string, init?: RequestInit, policy?: RedirectPolicy) => Promise<Response>;
export declare class JiraClient {
    private config;
    private authHeader;
    private fieldsCache?;
    private sprintFieldIdCache?;
    private storyPointsFieldIdCache?;
    private epicLinkFieldIdCache?;
    constructor(config: JiraConfig, apiToken: string);
    /**
     * Single HTTP entry point for the whole client. Every request goes through
     * {@link requestWithRedirectPolicy}, so no call site can silently inherit
     * `fetch`'s default `redirect: 'follow'`.
     */
    private httpRequest;
    /**
     * Memoises the outcome — success *and* failure — so a single client makes at
     * most one `GET /field`. A rejected catalog stays rejected: every field
     * detector and `readFieldCatalog` would otherwise retry the same dead
     * endpoint. Long-lived SDK clients can retry via {@link clearFieldCaches}.
     */
    listFields(): Promise<JiraFieldMeta[]>;
    clearFieldCaches(): void;
    detectSprintFieldId(): Promise<string | undefined>;
    detectStoryPointsFieldId(): Promise<string | undefined>;
    detectEpicLinkFieldId(): Promise<string | undefined>;
    convertADFToMarkdown(content: string | JiraADFDocument | null | undefined, attachments?: Array<{
        id: string;
        filename: string;
        url?: string;
    }>): string;
    private mergeHistory;
    private makeRequest;
    getCurrentUser(): Promise<{
        accountId: string;
        emailAddress?: string;
        displayName: string;
    }>;
    searchAssignableUsers(opts: {
        query: string;
        issueKey?: string;
        project?: string;
        maxResults?: number;
    }): Promise<JiraUser[]>;
    searchUsers(query: string, maxResults?: number): Promise<JiraUser[]>;
    fetchIssueDetails(issueKey: string, options?: FetchIssueDetailsOptions): Promise<JiraTaskData>;
    fetchIssueRaw(issueKey: string, expand?: string[]): Promise<RawIssue>;
    private buildTaskData;
    fetchIssueComments(issueKey: string, opts?: {
        rendered?: boolean;
    }): Promise<JiraComment[]>;
    getComment(issueKey: string, commentId: string): Promise<JiraComment>;
    fetchIssueWorklogs(issueKey: string): Promise<WorklogSummary[]>;
    fetchIssueChangelog(issueKey: string): Promise<JiraChangelogHistory[]>;
    fetchIssueSubtasks(parentKey: string): Promise<SubtaskSummary[]>;
    addComment(issueKey: string, wikiBody: string, parentCommentId?: string): Promise<{
        id: string;
    }>;
    addWorklog(issueKey: string, payload: {
        started: string;
        timeSpentSeconds: number;
        comment?: string;
        visibility?: {
            type: 'group' | 'role';
            value: string;
        };
    }): Promise<{
        id: string;
        issueId: string;
    }>;
    updateComment(issueKey: string, commentId: string, wikiBody: string): Promise<void>;
    updateCommentAdf(issueKey: string, commentId: string, adf: AdfDocument): Promise<void>;
    getIssueDescriptionAdf(issueKey: string): Promise<unknown>;
    updateIssueDescriptionAdf(issueKey: string, adf: AdfDocument): Promise<void>;
    deleteComment(issueKey: string, commentId: string): Promise<void>;
    private makeAgileRequest;
    findBoardByName(name: string): Promise<JiraBoard>;
    getBoardConfiguration(boardId: number): Promise<JiraBoardConfiguration>;
    getBoardColumnStatusIds(boardName: string, columnName: string): Promise<string[]>;
    getBoardColumnNames(boardName: string): Promise<string[]>;
    searchByJql(jql: string, fields?: string[]): Promise<JqlIssue[]>;
    searchIssues(jql: string, opts?: {
        fields?: string[];
        limit?: number;
        nextPageToken?: string;
    }): Promise<JiraSearchPage<JqlIssue>>;
    listProjects(opts?: {
        query?: string;
        startAt?: number;
        limit?: number;
    }): Promise<JiraPage<JiraProject>>;
    listBoards(opts?: {
        projectKey?: string;
        type?: 'scrum' | 'kanban' | 'simple';
        name?: string;
        startAt?: number;
        limit?: number;
    }): Promise<JiraPage<JiraBoard>>;
    listSprints(boardId: number, opts?: {
        state?: 'active' | 'future' | 'closed';
        startAt?: number;
        limit?: number;
    }): Promise<JiraPage<JiraSprint>>;
    listIssueTypes(projectKey?: string): Promise<JiraIssueType[]>;
    listComponents(projectKey: string): Promise<JiraComponent[]>;
    /**
     * Fetch the fields available on the create screen for a given issue type, including
     * allowedValues for select fields — helps users discover valid custom-field option strings.
     */
    getCreateFields(projectKey: string, issueTypeName: string): Promise<JiraCreateField[]>;
    listLinkTypes(): Promise<JiraIssueLinkType[]>;
    listPriorities(): Promise<JiraPriority[]>;
    listStatuses(projectKey?: string): Promise<JiraStatus[]>;
    /** URLs of the issue's remote links: the "Confluence content" panel and other web links. */
    getRemoteLinkUrls(issueKey: string): Promise<string[]>;
    /** Adds (or, for the same URL, updates) a web link shown under the issue's links. */
    addRemoteLink(issueKey: string, url: string, title: string): Promise<void>;
    getIssueTransitions(issueKey: string): Promise<JiraTransition[]>;
    resolveTransition(issueKey: string, targetStatus: string): Promise<{
        id: string;
        name: string;
        toName: string;
    }>;
    transitionIssue(issueKey: string, targetStatus: string, opts?: {
        dryRun?: boolean;
    }): Promise<Pick<JiraTransition, 'id' | 'name'>>;
    createIssue(input: {
        projectKey: string;
        issueType: string;
        summary: string;
        descriptionMarkdown?: string;
        noWiki?: boolean;
        assigneeAccountId?: string;
        labels?: string[];
        priority?: string;
        parentKey?: string;
        components?: string[];
        customFields?: Record<string, unknown>;
    }): Promise<{
        id: string;
        key: string;
        self: string;
    }>;
    editIssue(issueKey: string, input: {
        summary?: string;
        descriptionMarkdown?: string;
        noWiki?: boolean;
        assigneeAccountId?: string | null;
        labels?: string[];
        priority?: string;
        parentKey?: string;
        dueDate?: string;
        components?: string[];
        customFields?: Record<string, unknown>;
    }): Promise<void>;
    assignIssue(issueKey: string, accountIdOrNull: string | null): Promise<void>;
    linkIssues(inwardKey: string, outwardKey: string, linkTypeName: string, comment?: string): Promise<void>;
    removeIssueLink(linkId: string): Promise<void>;
    listWatchers(issueKey: string): Promise<JiraWatcher[]>;
    addWatcher(issueKey: string, accountId: string): Promise<void>;
    removeWatcher(issueKey: string, accountId: string): Promise<void>;
    uploadAttachment(issueKey: string, filePath: string): Promise<UploadedAttachment[]>;
    getAttachmentMeta(attachmentId: string): Promise<{
        id: string;
        filename: string;
        size: number;
        mimeType?: string;
        author?: string;
    }>;
    deleteAttachment(attachmentId: string): Promise<void>;
    downloadAttachment(attachmentUrl: string, outputPath: string): Promise<void>;
}
//# sourceMappingURL=jiraClient.d.ts.map