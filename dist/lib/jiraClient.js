import { createWriteStream } from 'fs';
import { mkdir, readFile, stat } from 'fs/promises';
import { basename, dirname } from 'path';
import { pipeline } from 'stream/promises';
import { COMMON_EPIC_FIELDS, PROJECTABLE_FIELDS, projectIssueFields } from './fieldProjection.js';
import { convertADFToMarkdown } from './adfToMarkdown.js';
import { markdownToWiki } from './markdownToWiki.js';
// Tolerates responses that are not real `Response` objects (test doubles,
// proxies) — a missing header bag must never mask the underlying HTTP error.
const headersToRecord = (headers) => {
    const record = {};
    if (typeof headers?.forEach !== 'function')
        return record;
    headers.forEach((value, key) => {
        record[key.toLowerCase()] = value;
    });
    return record;
};
const parseErrorMessages = (body) => {
    try {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== 'object')
            return undefined;
        const { errorMessages, errors } = parsed;
        const fromArray = Array.isArray(errorMessages)
            ? errorMessages.filter((entry) => typeof entry === 'string')
            : [];
        const fromFields = errors && typeof errors === 'object'
            ? Object.values(errors).filter((entry) => typeof entry === 'string')
            : [];
        const all = [...fromArray, ...fromFields];
        return all.length > 0 ? all : undefined;
    }
    catch {
        return undefined;
    }
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
export class JiraApiError extends Error {
    /** Duck-type brand — reliable where `instanceof` is not (bundled/duplicated copies). */
    isJiraApiError = true;
    status;
    statusText;
    body;
    headers;
    errorMessages;
    url;
    constructor(message, init) {
        super(message);
        // `instanceof` across a bundle boundary is unreliable, and transpiled
        // `extends Error` can lose the prototype entirely — pin it explicitly.
        Object.setPrototypeOf(this, JiraApiError.prototype);
        this.name = 'JiraApiError';
        this.status = init.status;
        this.statusText = init.statusText;
        this.body = init.body;
        this.headers = init.headers;
        this.url = init.url;
        this.errorMessages = parseErrorMessages(init.body);
    }
    /** First message Jira itself reported, if its error body was JSON. */
    get firstErrorMessage() {
        return this.errorMessages?.[0];
    }
    /** `Retry-After` in seconds, accepting both the delta and HTTP-date forms. */
    get retryAfterSeconds() {
        const raw = this.headers['retry-after'];
        if (!raw)
            return undefined;
        const seconds = Number(raw);
        if (Number.isFinite(seconds) && seconds >= 0)
            return seconds;
        const asDate = Date.parse(raw);
        if (Number.isNaN(asDate))
            return undefined;
        return Math.max(0, Math.round((asDate - Date.now()) / 1000));
    }
    /**
     * Atlassian's captcha challenge header — the only signal telling a user they
     * must log into Jira in a browser once before the API will answer again.
     */
    get deniedReason() {
        return this.headers['x-authentication-denied-reason'];
    }
    /**
     * Structural check that works across duplicated/bundled copies of this class,
     * where `instanceof` silently returns false.
     */
    static isJiraApiError(error) {
        return (error instanceof Error &&
            error.isJiraApiError === true &&
            typeof error.status === 'number');
    }
    /** Consumes the response body and builds the error with the legacy message. */
    static async fromResponse(response, prefix) {
        const body = await response.text();
        return new JiraApiError(`${prefix}: ${response.status} ${response.statusText}\n${body}`, {
            status: response.status,
            statusText: response.statusText,
            body,
            headers: headersToRecord(response.headers),
            url: response.url || undefined,
        });
    }
}
/** Standalone form of {@link JiraApiError.isJiraApiError}, for `import { isJiraApiError }`. */
export const isJiraApiError = (error) => JiraApiError.isJiraApiError(error);
export const DEFAULT_MAX_REDIRECTS = 3;
/**
 * Atlassian-owned domains a Jira Cloud request legitimately bounces to.
 * `atlassianusercontent.com` / `atl-paas.net` / `media.atlassian.com` are where
 * `/rest/api/3/attachment/content/{id}` sends attachment downloads.
 */
export const ATLASSIAN_REDIRECT_HOSTS = [
    '.atlassian.net',
    '.atlassian.com',
    '.jira.com',
    '.atl-paas.net',
    '.atlassianusercontent.com',
];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const normaliseHost = (hostname) => hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
const isPrivateIpv4 = (hostname) => {
    const parts = hostname.split('.');
    if (parts.length !== 4)
        return false;
    const octets = parts.map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255))
        return false;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127)
        return true;
    if (a === 169 && b === 254)
        return true;
    if (a === 172 && b >= 16 && b <= 31)
        return true;
    if (a === 192 && b === 168)
        return true;
    if (a === 192 && b === 0)
        return true;
    if (a === 198 && (b === 18 || b === 19))
        return true;
    if (a === 100 && b >= 64 && b <= 127)
        return true;
    return a >= 224;
};
/**
 * Literal addresses and names that must never be reached through a redirect.
 * Note this inspects the *name*, not what it resolves to — see the caveat on
 * {@link requestWithRedirectPolicy}.
 */
const isPrivateHost = (hostname) => {
    const host = normaliseHost(hostname);
    if (host === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/.test(host))
        return true;
    if (isPrivateIpv4(host))
        return true;
    if (!host.includes(':'))
        return false;
    // IPv6: loopback/unspecified, unique-local (fc00::/7), link-local (fe80::/10),
    // plus IPv4-mapped forms such as `::ffff:127.0.0.1`.
    if (host === '::1' || host === '::')
        return true;
    if (/^f[cd][0-9a-f]{0,2}:/.test(host))
        return true;
    if (/^fe[89ab][0-9a-f]?:/.test(host))
        return true;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
    return mapped ? isPrivateIpv4(mapped[1]) : false;
};
const isHostAllowed = (hostname, allowed) => {
    const host = normaliseHost(hostname);
    return allowed.some((raw) => {
        const entry = normaliseHost(raw.replace(/^\*/, ''));
        if (!entry)
            return false;
        if (!entry.startsWith('.'))
            return host === entry;
        return host === entry.slice(1) || host.endsWith(entry);
    });
};
const redirectRefused = (response, location, reason) => new JiraApiError(`Refused to follow redirect to ${location}: ${reason}`, {
    status: response.status,
    statusText: response.statusText,
    body: '',
    headers: headersToRecord(response.headers),
    url: response.url || undefined,
});
/** Case-insensitively drops credential headers before a cross-origin hop. */
const stripCredentialHeaders = (headers) => {
    const kept = {};
    const source = headers instanceof Headers || Array.isArray(headers)
        ? [...new Headers(headers).entries()]
        : Object.entries(headers ?? {});
    for (const [key, value] of source) {
        if (['authorization', 'cookie', 'proxy-authorization'].includes(key.toLowerCase()))
            continue;
        kept[key] = String(value);
    }
    return kept;
};
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
export const requestWithRedirectPolicy = async (input, init = {}, policy = {}) => {
    const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const allowedHosts = [...ATLASSIAN_REDIRECT_HOSTS, ...(policy.allowedRedirectHosts ?? [])];
    const origin = new URL(input);
    let currentUrl = input;
    let currentInit = { ...init, redirect: 'manual' };
    for (let hop = 0;; hop++) {
        const response = await fetch(currentUrl, currentInit);
        if (!REDIRECT_STATUSES.has(response.status))
            return response;
        const location = response.headers?.get?.('location');
        // A 3xx the caller is meant to see (300, 304, or a malformed redirect).
        if (!location)
            return response;
        if (hop >= maxRedirects) {
            throw redirectRefused(response, location, `exceeded ${maxRedirects} redirect hops`);
        }
        const from = new URL(currentUrl);
        let target;
        try {
            target = new URL(location, currentUrl);
        }
        catch {
            throw redirectRefused(response, location, 'target is not a valid URL');
        }
        // The host the caller originally asked for is never an escalation — a Data
        // Center install on a private address must keep working.
        const isOriginHost = normaliseHost(target.hostname) === normaliseHost(origin.hostname);
        if (target.protocol !== 'https:' && !(isOriginHost && target.protocol === from.protocol)) {
            throw redirectRefused(response, target.href, `scheme "${target.protocol}" is not allowed`);
        }
        if (!isOriginHost && isPrivateHost(target.hostname)) {
            throw redirectRefused(response, target.href, 'target is a private or loopback address');
        }
        if (!isOriginHost && !isHostAllowed(target.hostname, allowedHosts)) {
            throw redirectRefused(response, target.href, `host "${target.hostname}" is not in the allowed redirect hosts`);
        }
        const crossOrigin = target.origin !== from.origin;
        const method = (currentInit.method ?? 'GET').toUpperCase();
        // Per the fetch spec: 303 always becomes GET, and 301/302 do for POST.
        const downgradeToGet = response.status === 303 || (response.status !== 307 && response.status !== 308 && method === 'POST');
        const nextHeaders = crossOrigin ? stripCredentialHeaders(currentInit.headers) : currentInit.headers;
        currentInit = downgradeToGet
            ? { ...currentInit, method: 'GET', body: undefined, headers: nextHeaders, redirect: 'manual' }
            : { ...currentInit, headers: nextHeaders, redirect: 'manual' };
        currentUrl = target.href;
    }
};
const EPIC_LINK_CUSTOM_SCHEMA = 'com.pyxis.greenhopper.jira:gh-epic-link';
export class JiraClient {
    config;
    authHeader;
    fieldsCache;
    sprintFieldIdCache;
    storyPointsFieldIdCache;
    epicLinkFieldIdCache;
    constructor(config, apiToken) {
        this.config = config;
        this.authHeader = `Basic ${Buffer.from(`${config.userEmail}:${apiToken}`).toString('base64')}`;
    }
    /**
     * Single HTTP entry point for the whole client. Every request goes through
     * {@link requestWithRedirectPolicy}, so no call site can silently inherit
     * `fetch`'s default `redirect: 'follow'`.
     */
    httpRequest(url, init = {}) {
        return requestWithRedirectPolicy(url, init, this.config.redirects);
    }
    /**
     * Memoises the outcome — success *and* failure — so a single client makes at
     * most one `GET /field`. A rejected catalog stays rejected: every field
     * detector and `readFieldCatalog` would otherwise retry the same dead
     * endpoint. Long-lived SDK clients can retry via {@link clearFieldCaches}.
     */
    async listFields() {
        this.fieldsCache ??= this.makeRequest('/field');
        return this.fieldsCache;
    }
    clearFieldCaches() {
        this.fieldsCache = undefined;
        this.sprintFieldIdCache = undefined;
        this.storyPointsFieldIdCache = undefined;
        this.epicLinkFieldIdCache = undefined;
    }
    async detectSprintFieldId() {
        if (this.sprintFieldIdCache !== undefined)
            return this.sprintFieldIdCache ?? undefined;
        try {
            const fields = await this.listFields();
            const match = fields.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint' ||
                f.name?.toLowerCase() === 'sprint');
            this.sprintFieldIdCache = match?.id ?? null;
            return match?.id;
        }
        catch {
            this.sprintFieldIdCache = null;
            return undefined;
        }
    }
    async detectStoryPointsFieldId() {
        if (this.storyPointsFieldIdCache !== undefined)
            return this.storyPointsFieldIdCache ?? undefined;
        try {
            const fields = await this.listFields();
            const match = fields.find((f) => f.schema?.custom === 'com.atlassian.jira.plugin.system.customfieldtypes:float' &&
                /story\s*points?/i.test(f.name ?? '')) ?? fields.find((f) => /^story\s*points?$/i.test(f.name ?? ''));
            this.storyPointsFieldIdCache = match?.id ?? null;
            return match?.id;
        }
        catch {
            this.storyPointsFieldIdCache = null;
            return undefined;
        }
    }
    async detectEpicLinkFieldId() {
        if (this.epicLinkFieldIdCache !== undefined)
            return this.epicLinkFieldIdCache ?? undefined;
        try {
            const fields = await this.listFields();
            const match = fields.find((f) => f.schema?.custom === EPIC_LINK_CUSTOM_SCHEMA) ??
                fields.find((f) => /^epic\s*link$/i.test(f.name ?? ''));
            this.epicLinkFieldIdCache = match?.id ?? null;
            return match?.id;
        }
        catch {
            this.epicLinkFieldIdCache = null;
            return undefined;
        }
    }
    convertADFToMarkdown(content, attachments = []) {
        return convertADFToMarkdown(content, attachments);
    }
    mergeHistory(comments, changelog, attachmentMetadata = [], fullChangelog = false) {
        const history = [];
        for (const comment of comments) {
            history.push({
                type: 'comment',
                author: comment.author.displayName,
                date: comment.created,
                content: this.convertADFToMarkdown(comment.body, attachmentMetadata),
                id: comment.id,
                authorAccountId: comment.author.accountId,
            });
        }
        for (const change of changelog) {
            for (const item of change.items) {
                if (item.field === 'status') {
                    history.push({
                        type: 'status_change',
                        author: change.author.displayName,
                        date: change.created,
                        content: `${item.fromString || 'None'} → ${item.toString}`,
                    });
                    continue;
                }
                if (!fullChangelog)
                    continue;
                history.push({
                    type: 'field_change',
                    field: item.field,
                    author: change.author.displayName,
                    date: change.created,
                    content: `${item.field}: ${item.fromString || 'None'} → ${item.toString || 'None'}`,
                });
            }
        }
        history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        return history;
    }
    async makeRequest(endpoint, options = {}) {
        const url = `${this.config.baseUrl}/rest/api/3${endpoint}`;
        const response = await this.httpRequest(url, {
            ...options,
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });
        if (!response.ok) {
            throw await JiraApiError.fromResponse(response, 'Jira API request failed');
        }
        return response.json();
    }
    async getCurrentUser() {
        return this.makeRequest('/myself');
    }
    async searchAssignableUsers(opts) {
        const params = new URLSearchParams();
        params.set('query', opts.query);
        if (opts.issueKey)
            params.set('issueKey', opts.issueKey);
        if (opts.project)
            params.set('project', opts.project);
        params.set('maxResults', String(opts.maxResults ?? 50));
        return this.makeRequest(`/user/assignable/search?${params.toString()}`);
    }
    async searchUsers(query, maxResults = 50) {
        const params = new URLSearchParams();
        params.set('query', query);
        params.set('maxResults', String(maxResults));
        return this.makeRequest(`/user/search?${params.toString()}`);
    }
    async fetchIssueDetails(issueKey, options = {}) {
        const baseFields = [
            'summary',
            'description',
            'status',
            'parent',
            'attachment',
            'issuetype',
            ...COMMON_EPIC_FIELDS,
        ];
        const sprintFieldId = options.customFieldDefs?.sprint?.id ?? (await this.detectSprintFieldId());
        const storyPointsFieldId = options.customFieldDefs?.storyPoints?.id ?? (await this.detectStoryPointsFieldId());
        const includeComments = options.includeComments ?? true;
        const includeChangelog = options.includeChangelog ?? true;
        const extraFields = options.jiraFieldIds ?? [];
        const fieldSet = new Set([...baseFields, ...extraFields]);
        if (sprintFieldId)
            fieldSet.add(sprintFieldId);
        if (storyPointsFieldId)
            fieldSet.add(storyPointsFieldId);
        if (options.includeLinks)
            fieldSet.add('issuelinks');
        const fields = [...fieldSet].join(',');
        const response = await this.makeRequest(`/issue/${issueKey}?fields=${fields}`);
        const comments = includeComments ? await this.fetchIssueComments(issueKey) : [];
        const changelog = includeChangelog ? await this.fetchIssueChangelog(issueKey) : [];
        const attachmentMetadata = response.fields.attachment?.map((att) => ({
            id: att.id,
            filename: att.filename,
            url: att.content,
        })) || [];
        const history = this.mergeHistory(comments, changelog, attachmentMetadata, options.fullChangelog ?? false);
        const task = this.buildTaskData(response, attachmentMetadata, history, {
            sprintFieldId,
            storyPointsFieldId,
            customFieldDefs: options.customFieldDefs ?? {},
        });
        if (includeComments) {
            task.comments = comments.map((comment) => ({
                id: comment.id,
                author: comment.author.displayName,
                created: comment.created,
                body: this.convertADFToMarkdown(comment.body, attachmentMetadata),
            }));
        }
        if (options.includeWorklog)
            task.worklogs = await this.fetchIssueWorklogs(issueKey);
        return task;
    }
    async fetchIssueRaw(issueKey, expand = ['names']) {
        const params = new URLSearchParams({ fields: '*all', expand: expand.join(',') });
        return this.makeRequest(`/issue/${issueKey}?${params.toString()}`);
    }
    buildTaskData(response, attachmentMetadata, history, ctx) {
        const f = response.fields;
        const selectedKeys = [...PROJECTABLE_FIELDS, ...Object.keys(ctx.customFieldDefs)];
        const projected = projectIssueFields(f, selectedKeys, ctx);
        return {
            key: response.key,
            title: f.summary,
            ...projected,
            status: projected.status || 'Unknown',
            description: this.convertADFToMarkdown(f.description, attachmentMetadata),
            attachments: f.attachment?.map((att) => ({
                id: att.id,
                filename: att.filename,
                url: att.content,
                size: att.size,
            })) || [],
            history,
        };
    }
    async fetchIssueComments(issueKey, opts = {}) {
        const allComments = [];
        const maxResults = 100;
        let startAt = 0;
        let total;
        do {
            const params = new URLSearchParams({
                startAt: String(startAt),
                maxResults: String(maxResults),
            });
            if (opts.rendered)
                params.set('expand', 'renderedBody');
            const response = await this.makeRequest(`/issue/${issueKey}/comment?${params.toString()}`);
            allComments.push(...response.comments);
            total = response.total;
            startAt += response.maxResults;
        } while (startAt < total);
        return allComments;
    }
    async getComment(issueKey, commentId) {
        return this.makeRequest(`/issue/${issueKey}/comment/${commentId}`);
    }
    async fetchIssueWorklogs(issueKey) {
        const worklogs = [];
        const maxResults = 100;
        let startAt = 0;
        let total;
        do {
            const response = await this.makeRequest(`/issue/${issueKey}/worklog?startAt=${startAt}&maxResults=${maxResults}`);
            for (const worklog of response.worklogs) {
                const entry = {
                    author: worklog.author.displayName,
                    started: worklog.started,
                    timeSpent: worklog.timeSpent,
                };
                if (worklog.comment)
                    entry.comment = this.convertADFToMarkdown(worklog.comment);
                worklogs.push(entry);
            }
            total = response.total;
            startAt += response.maxResults;
        } while (startAt < total);
        return worklogs;
    }
    async fetchIssueChangelog(issueKey) {
        const response = await this.makeRequest(`/issue/${issueKey}?expand=changelog&fields=none`);
        return response.changelog.histories;
    }
    async fetchIssueSubtasks(parentKey) {
        const jql = `parent = ${parentKey} ORDER BY key ASC`;
        try {
            const response = await this.makeRequest(`/search/jql`, {
                method: 'POST',
                body: JSON.stringify({ jql, fields: ['summary', 'status'] }),
            });
            return response.issues.map((issue) => ({
                key: issue.key,
                title: issue.fields.summary,
                status: issue.fields.status?.name || 'Unknown',
            }));
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`Failed to fetch subtasks for ${parentKey}: ${errorMessage}`);
            return [];
        }
    }
    async addComment(issueKey, wikiBody, parentCommentId) {
        const url = `${this.config.baseUrl}/rest/api/2/issue/${issueKey}/comment`;
        const payload = { body: wikiBody };
        if (parentCommentId)
            payload.parentId = parentCommentId;
        const response = await this.httpRequest(url, {
            method: 'POST',
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw await JiraApiError.fromResponse(response, 'Jira addComment failed');
        }
        const json = (await response.json());
        return { id: json.id };
    }
    async addWorklog(issueKey, payload) {
        const url = `${this.config.baseUrl}/rest/api/2/issue/${issueKey}/worklog`;
        const response = await this.httpRequest(url, {
            method: 'POST',
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw await JiraApiError.fromResponse(response, 'Jira addWorklog failed');
        }
        const json = (await response.json());
        return { id: json.id, issueId: json.issueId };
    }
    async updateComment(issueKey, commentId, wikiBody) {
        const url = `${this.config.baseUrl}/rest/api/2/issue/${issueKey}/comment/${commentId}`;
        const response = await this.httpRequest(url, {
            method: 'PUT',
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ body: wikiBody }),
        });
        if (!response.ok) {
            throw await JiraApiError.fromResponse(response, 'Jira updateComment failed');
        }
    }
    async updateCommentAdf(issueKey, commentId, adf) {
        const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/comment/${commentId}`;
        const response = await this.httpRequest(url, {
            method: 'PUT',
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ body: adf }),
        });
        if (!response.ok) {
            throw await JiraApiError.fromResponse(response, 'Jira updateCommentAdf failed');
        }
    }
    async getIssueDescriptionAdf(issueKey) {
        const response = await this.makeRequest(`/issue/${issueKey}?fields=description`);
        return response.fields.description;
    }
    async updateIssueDescriptionAdf(issueKey, adf) {
        const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}`;
        const response = await this.httpRequest(url, {
            method: 'PUT',
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ fields: { description: adf } }),
        });
        if (!response.ok && response.status !== 204) {
            throw await JiraApiError.fromResponse(response, 'Jira updateIssueDescriptionAdf failed');
        }
    }
    async deleteComment(issueKey, commentId) {
        const url = `${this.config.baseUrl}/rest/api/2/issue/${issueKey}/comment/${commentId}`;
        const response = await this.httpRequest(url, {
            method: 'DELETE',
            headers: { Authorization: this.authHeader, Accept: 'application/json' },
        });
        if (!response.ok && response.status !== 204) {
            throw await JiraApiError.fromResponse(response, 'Jira deleteComment failed');
        }
    }
    async makeAgileRequest(endpoint, options = {}) {
        const url = `${this.config.baseUrl}/rest/agile/1.0${endpoint}`;
        const response = await this.httpRequest(url, {
            ...options,
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });
        if (!response.ok) {
            throw await JiraApiError.fromResponse(response, 'Jira Agile API request failed');
        }
        return response.json();
    }
    async findBoardByName(name) {
        const response = await this.makeAgileRequest(`/board?name=${encodeURIComponent(name)}`);
        const exact = response.values.find((b) => b.name.toLowerCase() === name.toLowerCase());
        if (exact)
            return exact;
        if (response.values.length === 1)
            return response.values[0];
        if (response.values.length === 0) {
            throw new Error(`No board found matching "${name}".`);
        }
        throw new Error(`Multiple boards matched "${name}": ${response.values.map((b) => b.name).join(', ')}. Use the exact name.`);
    }
    async getBoardConfiguration(boardId) {
        return this.makeAgileRequest(`/board/${boardId}/configuration`);
    }
    async getBoardColumnStatusIds(boardName, columnName) {
        const board = await this.findBoardByName(boardName);
        const config = await this.getBoardConfiguration(board.id);
        const column = config.columnConfig.columns.find((c) => c.name.toLowerCase() === columnName.toLowerCase());
        if (!column) {
            const available = config.columnConfig.columns.map((c) => c.name).join(', ');
            throw new Error(`Column "${columnName}" not found on board "${boardName}". Available: ${available}`);
        }
        return column.statuses.map((s) => s.id);
    }
    async getBoardColumnNames(boardName) {
        const board = await this.findBoardByName(boardName);
        const config = await this.getBoardConfiguration(board.id);
        return config.columnConfig.columns.map((c) => c.name);
    }
    async searchByJql(jql, fields = ['summary', 'status', 'assignee', 'issuetype']) {
        const all = [];
        let nextPageToken;
        do {
            const body = { jql, fields, maxResults: 100 };
            if (nextPageToken)
                body.nextPageToken = nextPageToken;
            const response = await this.makeRequest('/search/jql', { method: 'POST', body: JSON.stringify(body) });
            all.push(...response.issues);
            nextPageToken = response.isLast === false ? response.nextPageToken : undefined;
        } while (nextPageToken);
        return all;
    }
    async searchIssues(jql, opts = {}) {
        const body = {
            jql,
            fields: opts.fields ?? ['summary', 'status', 'assignee', 'issuetype'],
            maxResults: opts.limit ?? 50,
        };
        if (opts.nextPageToken)
            body.nextPageToken = opts.nextPageToken;
        const response = await this.makeRequest('/search/jql', { method: 'POST', body: JSON.stringify(body) });
        return {
            issues: response.issues,
            nextPageToken: response.nextPageToken,
            isLast: response.isLast !== false,
        };
    }
    async listProjects(opts = {}) {
        const params = new URLSearchParams();
        if (opts.query)
            params.set('query', opts.query);
        if (opts.startAt !== undefined)
            params.set('startAt', String(opts.startAt));
        if (opts.limit !== undefined)
            params.set('maxResults', String(opts.limit));
        const qs = params.toString();
        return this.makeRequest(`/project/search${qs ? `?${qs}` : ''}`);
    }
    async listBoards(opts = {}) {
        const params = new URLSearchParams();
        if (opts.projectKey)
            params.set('projectKeyOrId', opts.projectKey);
        if (opts.type)
            params.set('type', opts.type);
        if (opts.name)
            params.set('name', opts.name);
        if (opts.startAt !== undefined)
            params.set('startAt', String(opts.startAt));
        if (opts.limit !== undefined)
            params.set('maxResults', String(opts.limit));
        const qs = params.toString();
        return this.makeAgileRequest(`/board${qs ? `?${qs}` : ''}`);
    }
    async listSprints(boardId, opts = {}) {
        const params = new URLSearchParams();
        if (opts.state)
            params.set('state', opts.state);
        if (opts.startAt !== undefined)
            params.set('startAt', String(opts.startAt));
        if (opts.limit !== undefined)
            params.set('maxResults', String(opts.limit));
        const qs = params.toString();
        return this.makeAgileRequest(`/board/${boardId}/sprint${qs ? `?${qs}` : ''}`);
    }
    async listIssueTypes(projectKey) {
        if (!projectKey)
            return this.makeRequest('/issuetype');
        const project = await this.makeRequest(`/project/${projectKey}`);
        return this.makeRequest(`/issuetype/project?projectId=${project.id}`);
    }
    async listComponents(projectKey) {
        return this.makeRequest(`/project/${projectKey}/components`);
    }
    /**
     * Fetch the fields available on the create screen for a given issue type, including
     * allowedValues for select fields — helps users discover valid custom-field option strings.
     */
    async getCreateFields(projectKey, issueTypeName) {
        const types = await this.listIssueTypes(projectKey);
        const match = types.find((t) => t.name.toLowerCase() === issueTypeName.toLowerCase());
        if (!match) {
            throw new Error(`Issue type "${issueTypeName}" not found in project ${projectKey}. ` +
                `Available: ${types.map((t) => t.name).join(', ')}.`);
        }
        const response = await this.makeRequest(`/issue/createmeta/${projectKey}/issuetypes/${match.id}`);
        return response.fields.map((f) => ({
            fieldId: f.fieldId,
            name: f.name,
            required: f.required,
            schemaType: f.schema?.type,
            allowedValues: f.allowedValues
                ?.map((v) => v.value ?? v.name)
                .filter((v) => Boolean(v)),
        }));
    }
    async listLinkTypes() {
        const response = await this.makeRequest('/issueLinkType');
        return response.issueLinkTypes;
    }
    async listPriorities() {
        return this.makeRequest('/priority');
    }
    async listStatuses(projectKey) {
        if (!projectKey)
            return this.makeRequest('/status');
        const statuses = await this.makeRequest(`/project/${projectKey}/statuses`);
        const seen = new Map();
        for (const entry of statuses) {
            for (const s of entry.statuses)
                seen.set(s.id, s);
        }
        return [...seen.values()];
    }
    /** URLs of the issue's remote links: the "Confluence content" panel and other web links. */
    async getRemoteLinkUrls(issueKey) {
        const links = await this.makeRequest(`/issue/${issueKey}/remotelink`);
        return links.flatMap((l) => (l.object?.url ? [l.object.url] : []));
    }
    /** Adds (or, for the same URL, updates) a web link shown under the issue's links. */
    async addRemoteLink(issueKey, url, title) {
        await this.makeRequest(`/issue/${issueKey}/remotelink`, {
            method: 'POST',
            body: JSON.stringify({ globalId: url, object: { url, title } }),
        });
    }
    async getIssueTransitions(issueKey) {
        const response = await this.makeRequest(`/issue/${issueKey}/transitions`);
        return response.transitions;
    }
    async resolveTransition(issueKey, targetStatus) {
        const transitions = await this.getIssueTransitions(issueKey);
        const target = targetStatus.toLowerCase();
        const match = transitions.find((t) => t.to.name.toLowerCase() === target) ??
            transitions.find((t) => t.name.toLowerCase() === target);
        if (!match) {
            const available = transitions.map((t) => `"${t.name}" → "${t.to.name}"`).join(', ');
            throw new Error(`No transition to "${targetStatus}" available on ${issueKey}. Available: ${available}`);
        }
        return { id: match.id, name: match.name, toName: match.to.name };
    }
    async transitionIssue(issueKey, targetStatus, opts = {}) {
        const match = await this.resolveTransition(issueKey, targetStatus);
        if (opts.dryRun)
            return { id: match.id, name: match.name };
        const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/transitions`;
        const response = await this.httpRequest(url, {
            method: 'POST',
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ transition: { id: match.id } }),
        });
        if (!response.ok && response.status !== 204) {
            throw await JiraApiError.fromResponse(response, 'Jira transition failed');
        }
        return { name: match.name, id: match.id };
    }
    async createIssue(input) {
        const fields = {
            project: { key: input.projectKey },
            issuetype: { name: input.issueType },
            summary: input.summary,
        };
        if (input.descriptionMarkdown !== undefined) {
            fields.description = input.noWiki
                ? input.descriptionMarkdown
                : markdownToWiki(input.descriptionMarkdown);
        }
        if (input.assigneeAccountId)
            fields.assignee = { accountId: input.assigneeAccountId };
        if (input.labels)
            fields.labels = input.labels;
        if (input.priority)
            fields.priority = { name: input.priority };
        if (input.parentKey)
            fields.parent = { key: input.parentKey };
        if (input.components)
            fields.components = input.components.map((name) => ({ name }));
        if (input.customFields)
            Object.assign(fields, input.customFields);
        const url = `${this.config.baseUrl}/rest/api/2/issue`;
        const response = await this.httpRequest(url, {
            method: 'POST',
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ fields }),
        });
        if (!response.ok) {
            throw await JiraApiError.fromResponse(response, 'Jira createIssue failed');
        }
        return response.json();
    }
    async editIssue(issueKey, input) {
        const fields = {};
        if (input.summary !== undefined)
            fields.summary = input.summary;
        if (input.descriptionMarkdown !== undefined) {
            fields.description = input.noWiki
                ? input.descriptionMarkdown
                : markdownToWiki(input.descriptionMarkdown);
        }
        if (input.assigneeAccountId !== undefined) {
            fields.assignee = input.assigneeAccountId === null
                ? null
                : { accountId: input.assigneeAccountId };
        }
        if (input.labels !== undefined)
            fields.labels = input.labels;
        if (input.priority !== undefined)
            fields.priority = { name: input.priority };
        if (input.parentKey !== undefined)
            fields.parent = { key: input.parentKey };
        if (input.dueDate !== undefined)
            fields.duedate = input.dueDate;
        if (input.components !== undefined)
            fields.components = input.components.map((name) => ({ name }));
        if (input.customFields !== undefined)
            Object.assign(fields, input.customFields);
        if (Object.keys(fields).length === 0) {
            throw new Error('editIssue called with no fields to update.');
        }
        const url = `${this.config.baseUrl}/rest/api/2/issue/${issueKey}`;
        const response = await this.httpRequest(url, {
            method: 'PUT',
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ fields }),
        });
        if (!response.ok && response.status !== 204) {
            throw await JiraApiError.fromResponse(response, 'Jira editIssue failed');
        }
    }
    async assignIssue(issueKey, accountIdOrNull) {
        const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/assignee`;
        const response = await this.httpRequest(url, {
            method: 'PUT',
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ accountId: accountIdOrNull }),
        });
        if (!response.ok && response.status !== 204) {
            throw await JiraApiError.fromResponse(response, 'Jira assignIssue failed');
        }
    }
    async linkIssues(inwardKey, outwardKey, linkTypeName, comment) {
        const payload = {
            type: { name: linkTypeName },
            inwardIssue: { key: inwardKey },
            outwardIssue: { key: outwardKey },
        };
        if (comment)
            payload.comment = { body: markdownToWiki(comment) };
        const url = `${this.config.baseUrl}/rest/api/3/issueLink`;
        const response = await this.httpRequest(url, {
            method: 'POST',
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok && response.status !== 201) {
            throw await JiraApiError.fromResponse(response, 'Jira linkIssues failed');
        }
    }
    async removeIssueLink(linkId) {
        const url = `${this.config.baseUrl}/rest/api/3/issueLink/${linkId}`;
        const response = await this.httpRequest(url, {
            method: 'DELETE',
            headers: { Authorization: this.authHeader, Accept: 'application/json' },
        });
        if (!response.ok && response.status !== 204) {
            throw await JiraApiError.fromResponse(response, 'Jira removeIssueLink failed');
        }
    }
    async listWatchers(issueKey) {
        const response = await this.makeRequest(`/issue/${issueKey}/watchers`);
        return response.watchers;
    }
    async addWatcher(issueKey, accountId) {
        const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/watchers`;
        // Jira quirk: body is a JSON string (account id in quotes), not an object
        const response = await this.httpRequest(url, {
            method: 'POST',
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(accountId),
        });
        if (!response.ok && response.status !== 204) {
            throw await JiraApiError.fromResponse(response, 'Jira addWatcher failed');
        }
    }
    async removeWatcher(issueKey, accountId) {
        const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/watchers?accountId=${encodeURIComponent(accountId)}`;
        const response = await this.httpRequest(url, {
            method: 'DELETE',
            headers: { Authorization: this.authHeader, Accept: 'application/json' },
        });
        if (!response.ok && response.status !== 204) {
            throw await JiraApiError.fromResponse(response, 'Jira removeWatcher failed');
        }
    }
    async uploadAttachment(issueKey, filePath) {
        await stat(filePath);
        const buf = await readFile(filePath);
        const form = new FormData();
        const arr = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        form.append('file', new Blob([arr]), basename(filePath));
        const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/attachments`;
        const response = await this.httpRequest(url, {
            method: 'POST',
            headers: {
                Authorization: this.authHeader,
                Accept: 'application/json',
                'X-Atlassian-Token': 'no-check',
            },
            body: form,
        });
        if (!response.ok) {
            throw await JiraApiError.fromResponse(response, 'Jira uploadAttachment failed');
        }
        return response.json();
    }
    async getAttachmentMeta(attachmentId) {
        const meta = await this.makeRequest(`/attachment/${attachmentId}`);
        return {
            id: meta.id,
            filename: meta.filename,
            size: meta.size,
            mimeType: meta.mimeType,
            author: meta.author?.displayName,
        };
    }
    async deleteAttachment(attachmentId) {
        const url = `${this.config.baseUrl}/rest/api/3/attachment/${attachmentId}`;
        const response = await this.httpRequest(url, {
            method: 'DELETE',
            headers: { Authorization: this.authHeader, Accept: 'application/json' },
        });
        if (!response.ok && response.status !== 204) {
            throw await JiraApiError.fromResponse(response, 'Jira deleteAttachment failed');
        }
    }
    async downloadAttachment(attachmentUrl, outputPath) {
        await mkdir(dirname(outputPath), { recursive: true });
        const response = await this.httpRequest(attachmentUrl, {
            headers: { Authorization: this.authHeader },
        });
        if (!response.ok) {
            // Body is intentionally not consumed here (it is the file stream), so the
            // message keeps its historical shape without a trailing body section.
            throw new JiraApiError(`Failed to download attachment: ${response.status} ${response.statusText}`, {
                status: response.status,
                statusText: response.statusText,
                body: '',
                headers: headersToRecord(response.headers),
                url: response.url || undefined,
            });
        }
        if (!response.body)
            throw new Error('Response body is null');
        const fileStream = createWriteStream(outputPath);
        await pipeline(response.body, fileStream);
    }
}
//# sourceMappingURL=jiraClient.js.map