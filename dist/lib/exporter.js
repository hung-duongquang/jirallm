import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { JiraClient } from './jiraClient.js';
import { jiraIssueKeyFromUrl, linkLocalIssues } from './issueLinks.js';
import { CONFLUENCE_DIR, ConfluenceClient, exportConfluencePage, findLocalPageDir, } from './confluence.js';
import { collectConfluenceRefs, confluenceRefKey, rewriteConfluenceLinks, } from './confluenceLinks.js';
import { extractFrames, isVideoFile } from 'framewise';
import { resolveFieldSet, } from './exportFields.js';
const toInfo = ({ origin: _origin, dirName: _dirName, ...info }) => info;
const shortError = (error) => {
    const status = error?.status;
    if (typeof status === 'number')
        return `HTTP ${status}`;
    return (error instanceof Error ? error.message : String(error)).split('\n')[0];
};
/** Title of an earlier page export, read from its frontmatter. */
function localPageTitle(outputDir, dirName) {
    try {
        const text = readFileSync(join(outputDir, CONFLUENCE_DIR, dirName, 'page.md'), 'utf-8');
        const raw = /^ {2}title: "((?:[^"\\]|\\.)*)"$/m.exec(text)?.[1];
        return raw?.replace(/\\(.)/g, '$1');
    }
    catch {
        return undefined;
    }
}
/**
 * Confluence lookups of one export run: every page or whiteboard is fetched once, however
 * many issues link to it, and links resolve against what the run (or an earlier one) wrote.
 */
class ConfluenceRun {
    options;
    credentials;
    redirects;
    items = new Map();
    settled = new Map();
    clients = new Map();
    sites;
    constructor(options, credentials, redirects) {
        this.options = options;
        this.credentials = credentials;
        this.redirects = redirects;
        const configured = options.confluenceSites ?? [credentials.jiraOrigin];
        this.sites = new Set(configured.flatMap((site) => {
            try {
                return [new URL(site).origin.toLowerCase()];
            }
            catch {
                return [];
            }
        }));
    }
    /** Confluence items in `markdown` on a configured site. */
    refsIn(markdown) {
        return collectConfluenceRefs(markdown).filter((ref) => this.sites.has(ref.origin));
    }
    client(origin) {
        let client = this.clients.get(origin);
        if (!client) {
            const { userEmail, apiToken } = this.credentials;
            client = new ConfluenceClient(origin, userEmail, apiToken, this.redirects);
            this.clients.set(origin, client);
        }
        return client;
    }
    fetch(ref, url, via, batchKeys) {
        const key = confluenceRefKey(ref);
        let pending = this.items.get(key);
        if (!pending) {
            pending = this.load(ref, url, via, batchKeys).then((item) => {
                this.settled.set(key, item);
                this.options.onConfluenceItem?.(toInfo(item));
                return item;
            });
            this.items.set(key, pending);
        }
        return pending;
    }
    async load(ref, url, via, batchKeys) {
        const base = { kind: ref.kind, id: ref.id, origin: ref.origin, url, via };
        const client = this.client(ref.origin);
        if (ref.kind === 'whiteboard') {
            try {
                return { ...base, title: await client.getWhiteboardTitle(ref.id), status: 'linked' };
            }
            catch (error) {
                return { ...base, status: 'failed', error: shortError(error) };
            }
        }
        try {
            const page = await exportConfluencePage(client, ref.id, {
                outputDir: this.options.outputDir,
                batchKeys,
                localIssueLinks: this.options.localIssueLinks,
                resolveRef: (other) => this.resolve(other, '../'),
                // Whiteboards a page shows get their title; linked pages are not followed further.
                lookupRefs: async (refs) => {
                    for (const other of refs) {
                        if (other.kind === 'whiteboard' && this.sites.has(other.origin)) {
                            await this.fetch(other, other.url, via, batchKeys);
                        }
                    }
                },
            });
            return {
                ...base,
                title: page.title,
                path: page.path,
                dirName: page.dirName,
                status: page.status,
                attachmentCount: page.attachmentCount,
            };
        }
        catch (error) {
            // An earlier export still serves as the local copy.
            const dirName = findLocalPageDir(this.options.outputDir, ref.id);
            return {
                ...base,
                status: 'failed',
                error: shortError(error),
                dirName,
                title: dirName ? localPageTitle(this.options.outputDir, dirName) : undefined,
            };
        }
    }
    /**
     * How a link to `ref` is written from a file `pathToConfluenceDir` away from the
     * confluence folder: local page copies (this run's or earlier ones) and titled whiteboards.
     */
    resolve(ref, pathToConfluenceDir) {
        const item = this.settled.get(confluenceRefKey(ref));
        if (ref.kind === 'whiteboard')
            return item?.title ? { title: item.title } : undefined;
        // Pages this run did not look up may still have a copy from an earlier export.
        const dirName = item
            ? item.dirName
            : this.sites.has(ref.origin)
                ? findLocalPageDir(this.options.outputDir, ref.id)
                : undefined;
        if (!dirName)
            return undefined;
        const title = item?.title ?? localPageTitle(this.options.outputDir, dirName) ?? dirName;
        return { title, path: `${pathToConfluenceDir}${dirName}/page.md` };
    }
    all() {
        return [...this.settled.values()].map(toInfo);
    }
}
/** The "Confluence" section of task.md: what the issue links to, and what could not be read. */
function confluenceSection(items, resolve) {
    if (items.length === 0)
        return '';
    const escape = (text) => text.replace(/([[\]])/g, '\\$1');
    const lines = items.map((item) => {
        const resolved = resolve(item);
        if (item.kind === 'whiteboard') {
            const title = escape(`Whiteboard: ${item.title ?? item.id}`);
            const note = item.status === 'failed'
                ? `could not be read (${item.error})`
                : 'content is not exported (Confluence has no API for whiteboard content)';
            return `- [${title}](${item.url}) — ${note}`;
        }
        if (resolved?.path) {
            const stale = item.status === 'failed' ? ` — earlier copy; refreshing failed (${item.error})` : '';
            return `- [${escape(resolved.title)}](${resolved.path})${stale}`;
        }
        return `- ${item.url} — could not be exported (${item.error ?? 'unknown error'})`;
    });
    return `## Confluence\n\n${lines.join('\n')}\n\n`;
}
/** Issue keys an exported issue refers to on the same Jira site, in order of appearance. */
function linkedIssueKeys(task, baseUrl) {
    const host = (() => {
        try {
            return new URL(baseUrl).host.toLowerCase();
        }
        catch {
            return '';
        }
    })();
    const keys = (task.issueLinks ?? []).map((link) => link.key.toUpperCase());
    const texts = [task.description ?? '', ...task.history.map((entry) => entry.content)];
    for (const url of texts.join('\n').match(/https?:\/\/[^\s)\]]+/g) ?? []) {
        const key = jiraIssueKeyFromUrl(url);
        const sameSite = (() => {
            try {
                return new URL(url).host.toLowerCase() === host;
            }
            catch {
                return false;
            }
        })();
        if (key && sameSite)
            keys.push(key);
    }
    const self = task.key.toUpperCase();
    return [...new Set(keys)].filter((key) => key !== self);
}
const DEFAULT_VIDEO_OPTS = {
    fps: 5,
    quality: 85,
    maxFrames: 10,
};
function addFrameLinksToContent(content, taskDir) {
    const videoLinkRegex = /!\[([^\]]*)\]\((attachments\/[^)]+\.(mp4|mov|avi|webm|mkv|m4v|flv|wmv|mpg|mpeg))\)(?:\n📁 \[View \d+ extracted frames\]\(attachments\/[^)]+\))?/gi;
    return content.replace(videoLinkRegex, (match, _alt, videoPath) => {
        const filename = videoPath.split('/').pop();
        if (!filename)
            return match;
        const framesDirName = `${filename}-frames`;
        const framesDir = join(taskDir, 'attachments', framesDirName);
        const videoLinkMatch = match.match(/!\[[^\]]*\]\(attachments\/[^)]+\.(mp4|mov|avi|webm|mkv|m4v|flv|wmv|mpg|mpeg)\)/i);
        const videoLinkPart = videoLinkMatch ? videoLinkMatch[0] : match;
        if (existsSync(framesDir)) {
            const frameFiles = readdirSync(framesDir)
                .filter((f) => f.startsWith('frame-') && f.endsWith('.jpg'))
                .sort();
            if (frameFiles.length > 0) {
                return `${videoLinkPart}\n📁 [View ${frameFiles.length} extracted frames](attachments/${framesDirName}/)`;
            }
        }
        return videoLinkPart;
    });
}
function yamlQuote(value) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
function isEmpty(value) {
    if (value === undefined || value === null)
        return true;
    if (typeof value === 'string')
        return value === '';
    if (Array.isArray(value))
        return value.length === 0;
    if (typeof value === 'object')
        return Object.keys(value).length === 0;
    return false;
}
function serializeYamlValue(value, indent) {
    if (typeof value === 'string')
        return yamlQuote(value);
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (Array.isArray(value)) {
        if (value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
            const items = value.map((v) => (typeof v === 'string' ? yamlQuote(v) : String(v)));
            return `[${items.join(', ')}]`;
        }
        let out = '';
        for (const item of value) {
            out += `\n${indent}- ${serializeYamlObjectInline(item, `${indent}  `)}`;
        }
        return out;
    }
    if (typeof value === 'object' && value !== null) {
        let out = '';
        for (const [k, v] of Object.entries(value)) {
            if (isEmpty(v))
                continue;
            const serialized = serializeYamlValue(v, `${indent}  `);
            const needsBlock = typeof v === 'object' && v !== null && !Array.isArray(v) && !serialized.startsWith('\n');
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                out += `\n${indent}${k}:`;
                out += serialized.startsWith('\n') ? serialized : `\n${indent}  ${serialized}`;
            }
            else if (Array.isArray(v) && !serialized.startsWith('[')) {
                out += `\n${indent}${k}:${serialized}`;
            }
            else {
                out += `\n${indent}${k}: ${serialized}`;
            }
            void needsBlock;
        }
        return out;
    }
    return '';
}
function serializeYamlObjectInline(obj, indent) {
    if (typeof obj !== 'object' || obj === null) {
        return serializeYamlValue(obj, indent);
    }
    const entries = Object.entries(obj).filter(([, v]) => !isEmpty(v));
    if (entries.length === 0)
        return '{}';
    const [firstKey, firstVal] = entries[0];
    let out = `${firstKey}: ${serializeYamlValue(firstVal, indent)}`;
    for (const [k, v] of entries.slice(1)) {
        const serialized = serializeYamlValue(v, indent);
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            out += `\n${indent}${k}:${serialized.startsWith('\n') ? serialized : `\n${indent}  ${serialized}`}`;
        }
        else {
            out += `\n${indent}${k}: ${serialized}`;
        }
    }
    return out;
}
function formatIssueRef(ref) {
    if (!ref.title)
        return ref.key;
    return `${ref.key} - ${ref.title}`;
}
function buildFrontmatterBlock(task, selectedKeys) {
    const pickIfSelected = (key, val) => selectedKeys.has(key) && !isEmpty(val) ? val : undefined;
    const jira = {};
    // 'key' is implicit/always present
    jira.key = task.key;
    const status = pickIfSelected('status', task.status);
    if (status)
        jira.status = status;
    const issueType = pickIfSelected('issueType', task.issueType);
    if (issueType)
        jira.issueType = issueType;
    const priority = pickIfSelected('priority', task.priority);
    if (priority)
        jira.priority = priority;
    const resolution = pickIfSelected('resolution', task.resolution);
    if (resolution)
        jira.resolution = resolution;
    const assignee = pickIfSelected('assignee', task.assignee);
    if (assignee)
        jira.assignee = assignee;
    const reporter = pickIfSelected('reporter', task.reporter);
    if (reporter)
        jira.reporter = reporter;
    const creator = pickIfSelected('creator', task.creator);
    if (creator)
        jira.creator = creator;
    const createdAt = pickIfSelected('createdAt', task.createdAt);
    if (createdAt)
        jira.createdAt = createdAt;
    const updatedAt = pickIfSelected('updatedAt', task.updatedAt);
    if (updatedAt)
        jira.updatedAt = updatedAt;
    const dueDate = pickIfSelected('dueDate', task.dueDate);
    if (dueDate)
        jira.dueDate = dueDate;
    const resolutionDate = pickIfSelected('resolutionDate', task.resolutionDate);
    if (resolutionDate)
        jira.resolutionDate = resolutionDate;
    const components = pickIfSelected('components', task.components);
    if (components)
        jira.components = components;
    const labels = pickIfSelected('labels', task.labels);
    if (labels)
        jira.labels = labels;
    const fixVersions = pickIfSelected('fixVersions', task.fixVersions);
    if (fixVersions)
        jira.fixVersions = fixVersions;
    const versions = pickIfSelected('versions', task.versions);
    if (versions)
        jira.versions = versions;
    const sprint = pickIfSelected('sprint', task.sprint);
    if (sprint)
        jira.sprint = sprint;
    const storyPoints = pickIfSelected('storyPoints', task.storyPoints);
    if (storyPoints !== undefined)
        jira.storyPoints = storyPoints;
    const timetracking = pickIfSelected('timetracking', task.timetracking);
    if (timetracking)
        jira.timetracking = timetracking;
    if (selectedKeys.has('parent') && task.parent) {
        jira.parent = formatIssueRef(task.parent);
    }
    if (selectedKeys.has('epic') && task.epic) {
        jira.epic = formatIssueRef(task.epic);
    }
    if (selectedKeys.has('subtasks') && task.subtasks?.length) {
        jira.subtasks = task.subtasks.map((s) => ({
            key: s.key,
            title: s.title,
            status: s.status,
        }));
    }
    if (selectedKeys.has('issueLinks') && task.issueLinks?.length) {
        jira.issueLinks = task.issueLinks;
    }
    if (task.customFields && Object.keys(task.customFields).length > 0) {
        jira.customFields = task.customFields;
    }
    const body = serializeYamlValue(jira, '');
    return body.startsWith('\n') ? body.slice(1) : body;
}
function historyLabel(entry) {
    if (entry.type === 'comment')
        return 'COMMENT';
    if (entry.type === 'field_change')
        return `CHANGE (${entry.field})`;
    return 'STATUS CHANGE';
}
function buildTaskMarkdown(task, taskDir, selectedKeys, options = {}, confluence) {
    const frontmatterBody = buildFrontmatterBlock(task, selectedKeys);
    let md = `---\n${frontmatterBody}\n---\n\n# ${task.title}\n\n`;
    if (task.description?.trim()) {
        md += `## Description\n\n${addFrameLinksToContent(task.description, taskDir)}\n\n`;
    }
    if (confluence)
        md += confluence.section;
    const withStatusChanges = options.withStatusChanges ?? true;
    const withComments = options.withComments ?? true;
    const history = task.history.filter((entry) => entry.type === 'comment' ? withComments : withStatusChanges);
    if (history.length > 0) {
        md += withStatusChanges ? `## History\n\n` : `## Comments\n\n`;
        for (const entry of history) {
            const label = historyLabel(entry);
            const date = new Date(entry.date).toLocaleString();
            md += `---\n[${label}] ${entry.author} — ${date}:\n`;
            md += `${addFrameLinksToContent(entry.content, taskDir)}\n\n`;
        }
    }
    if (task.worklogs?.length) {
        md += `## Worklog\n\n`;
        for (const worklog of task.worklogs) {
            const date = new Date(worklog.started).toLocaleString();
            md += `---\n[WORKLOG] ${worklog.author} — ${date}: ${worklog.timeSpent}\n`;
            if (worklog.comment) {
                md += `${addFrameLinksToContent(worklog.comment, taskDir)}\n`;
            }
            md += `\n`;
        }
    }
    if (options.outputDir && options.localIssueLinks !== false) {
        md = linkLocalIssues(md, {
            outputDir: options.outputDir,
            selfKey: task.key,
            batchKeys: options.batchKeys,
        });
    }
    if (confluence)
        md = rewriteConfluenceLinks(md, confluence.resolve);
    return md;
}
export class JiraExporter {
    client;
    baseUrl;
    config;
    apiToken;
    constructor(config, apiToken) {
        this.client = new JiraClient(config, apiToken);
        this.baseUrl = config.baseUrl.replace(/\/+$/, '');
        this.config = config;
        this.apiToken = apiToken;
    }
    confluenceRun(options) {
        if (options.withConfluence === false)
            return undefined;
        let jiraOrigin = '';
        try {
            jiraOrigin = new URL(this.baseUrl).origin.toLowerCase();
        }
        catch {
            // An unusable base URL fails the Jira calls anyway.
        }
        return new ConfluenceRun(options, { userEmail: this.config.userEmail, apiToken: this.apiToken, jiraOrigin }, this.config.redirects);
    }
    async exportIssue(issueKey, options, context = {}) {
        const customFieldDefs = options.customFieldDefs ?? {};
        const resolved = resolveFieldSet(options.fieldSelector, customFieldDefs);
        const task = await this.client.fetchIssueDetails(issueKey, {
            jiraFieldIds: resolved.jiraFieldIds,
            customFieldDefs,
            fullChangelog: options.withHistory ?? false,
            includeWorklog: options.withWorklog ?? false,
        });
        if (options.includeSubtasks) {
            task.subtasks = await this.client.fetchIssueSubtasks(task.key);
        }
        const taskDir = join(options.outputDir, task.key.toLowerCase());
        const existed = existsSync(taskDir);
        mkdirSync(taskDir, { recursive: true });
        const selectedKeys = new Set(resolved.friendlyKeys);
        const taskMdPath = join(taskDir, 'task.md');
        const previousContent = existsSync(taskMdPath) ? readFileSync(taskMdPath, 'utf-8') : null;
        const linkedKeys = linkedIssueKeys(task, this.baseUrl);
        // Linked issues about to be exported in this run already count as local copies.
        const writeOptions = context.expandLinks
            ? { ...options, batchKeys: [...(options.batchKeys ?? []), ...linkedKeys] }
            : options;
        let markdown = buildTaskMarkdown(task, taskDir, selectedKeys, writeOptions);
        // Confluence pages the issue links to are exported first so task.md can link their copies.
        const confluence = context.confluence ?? this.confluenceRun(options);
        if (confluence) {
            const items = [];
            for (const ref of confluence.refsIn(markdown)) {
                items.push(await confluence.fetch(ref, ref.url, task.key, writeOptions.batchKeys ?? []));
            }
            const resolve = (ref) => confluence.resolve(ref, `../${CONFLUENCE_DIR}/`);
            markdown = buildTaskMarkdown(task, taskDir, selectedKeys, writeOptions, {
                section: confluenceSection(items, resolve),
                resolve,
            });
        }
        writeFileSync(taskMdPath, markdown, 'utf-8');
        const videos = [];
        if (task.attachments.length > 0) {
            const attachmentsDir = join(taskDir, 'attachments');
            mkdirSync(attachmentsDir, { recursive: true });
            const downloaded = new Set();
            const processedVideos = new Set();
            console.log(`  ↓ ${task.key}: downloading ${task.attachments.length} attachment(s)...`);
            for (const att of task.attachments) {
                let filename = att.filename;
                let counter = 1;
                while (downloaded.has(filename)) {
                    const dot = att.filename.lastIndexOf('.');
                    if (dot !== -1) {
                        filename = `${att.filename.substring(0, dot)}-${counter}${att.filename.substring(dot)}`;
                    }
                    else {
                        filename = `${att.filename}-${counter}`;
                    }
                    counter++;
                }
                downloaded.add(filename);
                const attPath = join(attachmentsDir, filename);
                if (!existsSync(attPath)) {
                    await this.client.downloadAttachment(att.url, attPath);
                }
                if (options.videoFrames?.enabled &&
                    isVideoFile(filename) &&
                    existsSync(attPath) &&
                    !processedVideos.has(`${task.key}:${att.id}`)) {
                    const framesDir = join(attachmentsDir, `${filename}-frames`);
                    const opts = { ...DEFAULT_VIDEO_OPTS, ...options.videoFrames };
                    console.log(`  🎬 ${filename}: extracting frames (fps=${opts.fps}, max=${opts.maxFrames})...`);
                    try {
                        const result = await extractFrames(attPath, framesDir, {
                            fps: opts.fps,
                            format: 'jpeg',
                            quality: opts.quality,
                            maxFrames: opts.maxFrames,
                        });
                        console.log(`  ✓ ${filename}: extracted ${result.extractedCount} frames, kept ${result.keptCount}`);
                        videos.push({
                            filename,
                            frameCount: result.extractedCount,
                            dedupedCount: result.keptCount,
                        });
                    }
                    catch (error) {
                        const msg = error instanceof Error ? error.message : String(error);
                        console.warn(`  ⚠ ${filename}: ${msg}`);
                        videos.push({
                            filename,
                            frameCount: 0,
                            dedupedCount: 0,
                            error: msg,
                        });
                    }
                    processedVideos.add(`${task.key}:${att.id}`);
                }
            }
        }
        const finalContent = readFileSync(taskMdPath, 'utf-8');
        const updated = addFrameLinksToContent(finalContent, taskDir);
        if (updated !== finalContent)
            writeFileSync(taskMdPath, updated, 'utf-8');
        return {
            taskDir,
            taskMdPath,
            attachmentCount: task.attachments.length,
            videos,
            canonicalKey: task.key,
            existed,
            parentKey: task.parent?.key,
            linkedKeys,
            previousContent,
        };
    }
    async exportIssues(issueKeys, options) {
        const result = {
            imported: [],
            updated: [],
            failed: [],
            cancelled: [],
            confluence: [],
        };
        const confluence = this.confluenceRun(options);
        if (!existsSync(options.outputDir)) {
            mkdirSync(options.outputDir, { recursive: true });
        }
        const gitignorePath = join(options.outputDir, '.gitignore');
        if (!existsSync(gitignorePath)) {
            writeFileSync(gitignorePath, '*\n', 'utf-8');
        }
        const seen = new Set();
        const queue = issueKeys.map((key) => ({ key, requested: true }));
        // Every issue this run will try to write; links between them are local.
        const runKeys = new Set([...issueKeys, ...(options.batchKeys ?? [])].map((k) => k.toUpperCase()));
        const written = [];
        const failedLinked = [];
        for (let i = 0; i < queue.length; i++) {
            const { key, requested, via } = queue[i];
            const dedupeKey = key.toLowerCase();
            if (seen.has(dedupeKey))
                continue;
            seen.add(dedupeKey);
            if (options.signal?.aborted) {
                result.cancelled.push(key);
                continue;
            }
            try {
                options.onIssueStart?.(key, { requested, via });
                const expandLinks = Boolean(options.includeLinked && requested);
                const outcome = await this.exportIssue(key, { ...options, batchKeys: [...runKeys] }, { expandLinks, confluence });
                seen.add(outcome.canonicalKey.toLowerCase());
                written.push(outcome.taskMdPath);
                (outcome.existed ? result.updated : result.imported).push({
                    key,
                    path: outcome.taskMdPath,
                    attachmentCount: outcome.attachmentCount,
                    videos: outcome.videos,
                });
                await options.onIssueWritten?.({
                    key: outcome.canonicalKey,
                    path: outcome.taskMdPath,
                    previous: outcome.previousContent,
                    current: readFileSync(outcome.taskMdPath, 'utf-8'),
                    requested,
                    via,
                    attachmentCount: outcome.attachmentCount,
                });
                if (options.includeParent && outcome.parentKey) {
                    queue.push({ key: outcome.parentKey, requested: false });
                }
                if (expandLinks) {
                    for (const linked of outcome.linkedKeys) {
                        runKeys.add(linked);
                        queue.push({ key: linked, requested: false, via: outcome.canonicalKey });
                    }
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                options.onIssueFailed?.(key, { requested, via, error: message });
                if (!requested) {
                    const what = via ? `linked issue (from ${via})` : 'parent';
                    console.warn(`Failed to fetch ${what} ${key}: ${message}`);
                    if (via)
                        failedLinked.push(key);
                    continue;
                }
                result.failed.push({ key, error: message });
            }
        }
        // Linked issues that could not be fetched (or were cancelled) were already linked locally;
        // point those links back at Jira unless an earlier export left a local copy.
        const missing = [...failedLinked, ...result.cancelled].filter((key) => !existsSync(join(options.outputDir, key.toLowerCase(), 'task.md')));
        if (missing.length > 0) {
            for (const path of written) {
                const content = readFileSync(path, 'utf-8');
                let next = content;
                for (const key of missing) {
                    const local = `](../${key.toLowerCase()}/task.md)`;
                    next = next.split(local).join(`](${this.baseUrl}/browse/${key})`);
                }
                if (next !== content)
                    writeFileSync(path, next, 'utf-8');
            }
        }
        result.confluence = confluence?.all() ?? [];
        return result;
    }
}
//# sourceMappingURL=exporter.js.map