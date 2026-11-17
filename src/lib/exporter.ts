import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { JiraClient, type JiraConfig, type JiraTaskData } from './jiraClient.js';
import { jiraIssueKeyFromUrl, linkLocalIssues } from './issueLinks.js';
import {
  CONFLUENCE_DIR,
  ConfluenceClient,
  exportConfluencePage,
  findLocalPageDir,
} from './confluence.js';
import {
  collectConfluenceRefs,
  confluenceRefKey,
  rewriteConfluenceLinks,
  type ConfluenceRef,
  type ResolvedConfluenceRef,
} from './confluenceLinks.js';
import { extractFrames, isVideoFile } from 'framewise';
import {
  resolveFieldSet,
  type CustomFieldDefs,
  type FieldSelector,
} from './exportFields.js';
import {
  assertNotSymlink,
  assertRealPathInside,
  assignAttachmentFilenames,
  ensureRealDirectory,
  entryExists,
  framesDirName,
  isRealDirectory,
  isRegularFile,
  isSafeIssueKey,
  removeEntry,
  resolveContainedPath,
  writeFileAtomic,
  writeViaTempFile,
} from './safePath.js';
import {
  createNonce,
  isControlChar,
  toSingleLine,
  untrustedNotice,
  wrapUntrusted,
} from './untrusted.js';
import { readVideoDuration, type VideoDurationProbe } from './videoSize.js';

export type ExportOptions = {
  outputDir: string;
  includeSubtasks?: boolean;
  includeParent?: boolean;
  fieldSelector?: FieldSelector;
  customFieldDefs?: CustomFieldDefs;
  withHistory?: boolean;
  /** Write status (and, with `withHistory`, field) changes to task.md. Default: true. */
  withStatusChanges?: boolean;
  /** Write issue comments to task.md. Default: true. */
  withComments?: boolean;
  /**
   * Point links to other Jira issues at their local copy in `outputDir` (an exported
   * `<key>/task.md` or a loose `KEY….md`) when one exists. Default: true.
   */
  localIssueLinks?: boolean;
  /** Issues exported in the same run (linked locally although not written yet). */
  batchKeys?: string[];
  /**
   * Also try to export the issues each requested issue links to (its issue links and Jira
   * issue URLs in its description/comments), one level deep. An inaccessible linked issue is
   * skipped and links to it stay pointed at Jira.
   */
  includeLinked?: boolean;
  /** Called before each issue is fetched (`via` names the requested issue that linked it). */
  onIssueStart?: (key: string, info: { requested: boolean; via?: string }) => void;
  /** Called after an issue's task.md is final, with the content it replaced (null if new). */
  onIssueWritten?: (info: {
    key: string;
    path: string;
    previous: string | null;
    current: string;
    requested: boolean;
    via?: string;
    attachmentCount: number;
  }) => void | Promise<void>;
  /** Called when an issue could not be exported. */
  onIssueFailed?: (key: string, info: { requested: boolean; via?: string; error: string }) => void;
  /**
   * Stops the run before the next issue once aborted; the issue in progress is finished.
   * Links to issues that were not reached point back at Jira unless a local copy exists.
   */
  signal?: AbortSignal;
  /**
   * Export the Confluence pages an issue links to (one level) into `<outputDir>/confluence/`
   * and point the links at them; whiteboard links get their title. Default: true.
   */
  withConfluence?: boolean;
  /**
   * Confluence sites (e.g. `https://acme.atlassian.net`) whose pages are fetched with the
   * Jira credentials. Links to other sites are left alone. Default: the Jira site.
   */
  confluenceSites?: string[];
  /** Called once per Confluence page or whiteboard an export run looked up. */
  onConfluenceItem?: (info: ConfluenceItemInfo) => void;
  withWorklog?: boolean;
  videoFrames?: {
    enabled: boolean;
    fps?: number;
    quality?: number;
    maxFrames?: number;
    maxDurationSeconds?: number;
  };
};

export type VideoExtractionInfo = {
  filename: string;
  frameCount: number;
  dedupedCount: number;
  error?: string;
};

export type ExportedItem = {
  key: string;
  path: string;
  attachmentCount: number;
  videos: VideoExtractionInfo[];
};

export type ExportResult = {
  imported: ExportedItem[];
  updated: ExportedItem[];
  failed: Array<{ key: string; error: string }>;
  /** Issues not reached because `signal` was aborted. */
  cancelled: string[];
  /** Confluence pages and whiteboards looked up for the exported issues. */
  confluence: ConfluenceItemInfo[];
};

export type ConfluenceItemInfo = {
  kind: 'page' | 'whiteboard';
  id: string;
  url: string;
  title?: string;
  /** Local page.md (pages only). */
  path?: string;
  status: 'new' | 'changed' | 'unchanged' | 'linked' | 'failed';
  attachmentCount?: number;
  error?: string;
  /** The issue that first linked it. */
  via: string;
};

type ConfluenceItem = ConfluenceItemInfo & {
  origin: string;
  /** Folder name below `<outputDir>/confluence/` of the local copy, if any. */
  dirName?: string;
};

const toInfo = ({ origin: _origin, dirName: _dirName, ...info }: ConfluenceItem): ConfluenceItemInfo =>
  info;

const shortError = (error: unknown): string => {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === 'number') return `HTTP ${status}`;
  return (error instanceof Error ? error.message : String(error)).split('\n')[0];
};

/** Title of an earlier page export, read from its frontmatter. */
function localPageTitle(outputDir: string, dirName: string): string | undefined {
  try {
    const text = readFileSync(join(outputDir, CONFLUENCE_DIR, dirName, 'page.md'), 'utf-8');
    const raw = /^ {2}title: "((?:[^"\\]|\\.)*)"$/m.exec(text)?.[1];
    return raw?.replace(/\\(.)/g, '$1');
  } catch {
    return undefined;
  }
}

/**
 * Confluence lookups of one export run: every page or whiteboard is fetched once, however
 * many issues link to it, and links resolve against what the run (or an earlier one) wrote.
 */
class ConfluenceRun {
  private readonly items = new Map<string, Promise<ConfluenceItem>>();
  private readonly settled = new Map<string, ConfluenceItem>();
  private readonly clients = new Map<string, ConfluenceClient>();
  private readonly sites: Set<string>;

  constructor(
    private readonly options: ExportOptions,
    private readonly credentials: { userEmail: string; apiToken: string; jiraOrigin: string },
    private readonly redirects: JiraConfig['redirects']
  ) {
    const configured = options.confluenceSites ?? [credentials.jiraOrigin];
    this.sites = new Set(
      configured.flatMap((site) => {
        try {
          return [new URL(site).origin.toLowerCase()];
        } catch {
          return [];
        }
      })
    );
  }

  /** Confluence items in `markdown` on a configured site. */
  refsIn(markdown: string): Array<ConfluenceRef & { url: string }> {
    return collectConfluenceRefs(markdown).filter((ref) => this.sites.has(ref.origin));
  }

  private client(origin: string): ConfluenceClient {
    let client = this.clients.get(origin);
    if (!client) {
      const { userEmail, apiToken } = this.credentials;
      client = new ConfluenceClient(origin, userEmail, apiToken, this.redirects);
      this.clients.set(origin, client);
    }
    return client;
  }

  fetch(ref: ConfluenceRef, url: string, via: string, batchKeys: string[]): Promise<ConfluenceItem> {
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

  private async load(
    ref: ConfluenceRef,
    url: string,
    via: string,
    batchKeys: string[]
  ): Promise<ConfluenceItem> {
    const base = { kind: ref.kind, id: ref.id, origin: ref.origin, url, via };
    const client = this.client(ref.origin);
    if (ref.kind === 'whiteboard') {
      try {
        return { ...base, title: await client.getWhiteboardTitle(ref.id), status: 'linked' };
      } catch (error) {
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
    } catch (error) {
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
  resolve(ref: ConfluenceRef, pathToConfluenceDir: string): ResolvedConfluenceRef | undefined {
    const item = this.settled.get(confluenceRefKey(ref));
    if (ref.kind === 'whiteboard') return item?.title ? { title: item.title } : undefined;
    // Pages this run did not look up may still have a copy from an earlier export.
    const dirName = item
      ? item.dirName
      : this.sites.has(ref.origin)
        ? findLocalPageDir(this.options.outputDir, ref.id)
        : undefined;
    if (!dirName) return undefined;
    const title = item?.title ?? localPageTitle(this.options.outputDir, dirName) ?? dirName;
    return { title, path: `${pathToConfluenceDir}${dirName}/page.md` };
  }

  all(): ConfluenceItemInfo[] {
    return [...this.settled.values()].map(toInfo);
  }
}

/** The "Confluence" section of task.md: what the issue links to, and what could not be read. */
function confluenceSection(
  items: ConfluenceItem[],
  resolve: (ref: ConfluenceRef) => ResolvedConfluenceRef | undefined
): string {
  if (items.length === 0) return '';
  const escape = (text: string) => text.replace(/([[\]])/g, '\\$1');
  const lines = items.map((item) => {
    const resolved = resolve(item);
    if (item.kind === 'whiteboard') {
      const title = escape(`Whiteboard: ${item.title ?? item.id}`);
      const note =
        item.status === 'failed'
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

type ExportIssueOutcome = {
  taskDir: string;
  taskMdPath: string;
  attachmentCount: number;
  videos: VideoExtractionInfo[];
  canonicalKey: string;
  existed: boolean;
  parentKey?: string;
  /** Issues this one links to on the same Jira site (issue links + issue URLs in its text). */
  linkedKeys: string[];
  /** task.md content before this export, or null when it did not exist. */
  previousContent: string | null;
};

type QueueEntry = {
  key: string;
  requested: boolean;
  /** For linked issues: the requested issue that links to it. */
  via?: string;
};

/** Issue keys an exported issue refers to on the same Jira site, in order of appearance. */
function linkedIssueKeys(task: JiraTaskData, baseUrl: string): string[] {
  const host = (() => {
    try {
      return new URL(baseUrl).host.toLowerCase();
    } catch {
      return '';
    }
  })();
  const keys = [
    ...(task.issueLinks ?? []).map((link) => link.key.toUpperCase()),
    ...(task.subtasks ?? []).map((subtask) => subtask.key.toUpperCase()),
  ];
  const texts = [task.description ?? '', ...task.history.map((entry) => entry.content)];
  for (const url of texts.join('\n').match(/https?:\/\/[^\s)\]]+/g) ?? []) {
    const key = jiraIssueKeyFromUrl(url);
    const sameSite = (() => {
      try {
        return new URL(url).host.toLowerCase() === host;
      } catch {
        return false;
      }
    })();
    if (key && sameSite) keys.push(key);
  }
  const self = task.key.toUpperCase();
  return [...new Set(keys)].filter((key) => key !== self);
}


const DEFAULT_VIDEO_OPTS = {
  fps: 5,
  quality: 85,
  maxFrames: 10,
} as const;

export const DEFAULT_MAX_VIDEO_DURATION_SECONDS = 30 * 60;

const ATTACHMENTS_DIR = 'attachments';
const TASK_MD = 'task.md';

type FrameCounts = ReadonlyMap<string, number>;

type RenderContext = {
  selectedKeys: Set<string>;
  nonce: string;
  frameCounts: FrameCounts;
};

const VIDEO_LINK_REGEX =
  /!\[([^\]]*)\]\(attachments\/([^)]+\.(?:mp4|mov|avi|webm|mkv|m4v|flv|wmv|mpg|mpeg))\)(?:\n📁 \[View \d+ extracted frames\]\(attachments\/[^)]+\))?/gi;

function addFrameLinksToContent(content: string, frameCounts: FrameCounts): string {
  return content.replace(VIDEO_LINK_REGEX, (_match: string, alt: string, filename: string) => {
    const videoLink = `![${alt}](${ATTACHMENTS_DIR}/${filename})`;
    const count = frameCounts.get(filename) ?? 0;
    if (count === 0) return videoLink;
    return `${videoLink}\n📁 [View ${count} extracted frames](${ATTACHMENTS_DIR}/${framesDirName(filename)}/)`;
  });
}

function countFrames(framesDir: string): number {
  if (!isRealDirectory(framesDir)) return 0;
  return readdirSync(framesDir).filter((f) => f.startsWith('frame-') && f.endsWith('.jpg')).length;
}

function readFrameCounts(attachmentsDir: string, filenames: readonly string[]): FrameCounts {
  if (!isRealDirectory(attachmentsDir)) return new Map();
  return new Map(
    filenames
      .filter((name) => isVideoFile(name))
      .map((name) => [name, countFrames(join(attachmentsDir, framesDirName(name)))] as const)
  );
}

const YAML_ESCAPES = new Map([
  ['\\', '\\\\'],
  ['"', '\\"'],
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t'],
  ['\u0085', '\\N'],
  [' ', '\\L'],
  [' ', '\\P'],
]);

const SAFE_YAML_KEY = /^[A-Za-z0-9_.-]+$/;

function escapeYamlChar(ch: string): string {
  const named = YAML_ESCAPES.get(ch);
  if (named) return named;
  if (!isControlChar(ch)) return ch;
  return `\\u${(ch.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`;
}

function yamlQuote(value: string): string {
  return `"${[...value].map(escapeYamlChar).join('')}"`;
}

function yamlKey(key: string): string {
  return SAFE_YAML_KEY.test(key) ? key : yamlQuote(key);
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function serializeYamlValue(value: unknown, indent: string): string {
  if (typeof value === 'string') return yamlQuote(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
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
      if (isEmpty(v)) continue;
      const serialized = serializeYamlValue(v, `${indent}  `);
      const needsBlock = typeof v === 'object' && v !== null && !Array.isArray(v) && !serialized.startsWith('\n');
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        out += `\n${indent}${yamlKey(k)}:`;
        out += serialized.startsWith('\n') ? serialized : `\n${indent}  ${serialized}`;
      } else if (Array.isArray(v) && !serialized.startsWith('[')) {
        out += `\n${indent}${yamlKey(k)}:${serialized}`;
      } else {
        out += `\n${indent}${yamlKey(k)}: ${serialized}`;
      }
      void needsBlock;
    }
    return out;
  }
  return '';
}

function serializeYamlObjectInline(obj: unknown, indent: string): string {
  if (typeof obj !== 'object' || obj === null) {
    return serializeYamlValue(obj, indent);
  }
  const entries = Object.entries(obj).filter(([, v]) => !isEmpty(v));
  if (entries.length === 0) return '{}';
  const [firstKey, firstVal] = entries[0];
  let out = `${yamlKey(firstKey)}: ${serializeYamlValue(firstVal, indent)}`;
  for (const [k, v] of entries.slice(1)) {
    const serialized = serializeYamlValue(v, indent);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out += `\n${indent}${yamlKey(k)}:${serialized.startsWith('\n') ? serialized : `\n${indent}  ${serialized}`}`;
    } else {
      out += `\n${indent}${yamlKey(k)}: ${serialized}`;
    }
  }
  return out;
}

function formatIssueRef(ref: { key: string; title?: string }): string {
  if (!ref.title) return ref.key;
  return `${ref.key} - ${ref.title}`;
}

function buildFrontmatterBlock(task: JiraTaskData, selectedKeys: Set<string>): string {
  const pickIfSelected = <T,>(key: string, val: T | undefined): T | undefined =>
    selectedKeys.has(key) && !isEmpty(val) ? val : undefined;

  const jira: Record<string, unknown> = {};
  // 'key' is implicit/always present
  jira.key = task.key;

  const status = pickIfSelected('status', task.status);
  if (status) jira.status = status;
  const issueType = pickIfSelected('issueType', task.issueType);
  if (issueType) jira.issueType = issueType;
  const priority = pickIfSelected('priority', task.priority);
  if (priority) jira.priority = priority;
  const resolution = pickIfSelected('resolution', task.resolution);
  if (resolution) jira.resolution = resolution;
  const assignee = pickIfSelected('assignee', task.assignee);
  if (assignee) jira.assignee = assignee;
  const reporter = pickIfSelected('reporter', task.reporter);
  if (reporter) jira.reporter = reporter;
  const creator = pickIfSelected('creator', task.creator);
  if (creator) jira.creator = creator;
  const createdAt = pickIfSelected('createdAt', task.createdAt);
  if (createdAt) jira.createdAt = createdAt;
  const updatedAt = pickIfSelected('updatedAt', task.updatedAt);
  if (updatedAt) jira.updatedAt = updatedAt;
  if (updatedAt && task.commentsUpdatedAt) jira.commentsUpdatedAt = task.commentsUpdatedAt;
  if (updatedAt && task.commentCount !== undefined) jira.commentCount = task.commentCount;
  const dueDate = pickIfSelected('dueDate', task.dueDate);
  if (dueDate) jira.dueDate = dueDate;
  const resolutionDate = pickIfSelected('resolutionDate', task.resolutionDate);
  if (resolutionDate) jira.resolutionDate = resolutionDate;
  const components = pickIfSelected('components', task.components);
  if (components) jira.components = components;
  const labels = pickIfSelected('labels', task.labels);
  if (labels) jira.labels = labels;
  const fixVersions = pickIfSelected('fixVersions', task.fixVersions);
  if (fixVersions) jira.fixVersions = fixVersions;
  const versions = pickIfSelected('versions', task.versions);
  if (versions) jira.versions = versions;
  const sprint = pickIfSelected('sprint', task.sprint);
  if (sprint) jira.sprint = sprint;
  const storyPoints = pickIfSelected('storyPoints', task.storyPoints);
  if (storyPoints !== undefined) jira.storyPoints = storyPoints;
  const timetracking = pickIfSelected('timetracking', task.timetracking);
  if (timetracking) jira.timetracking = timetracking;

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
      ...(s.assignee ? { assignee: s.assignee } : {}),
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

function historyLabel(entry: JiraTaskData['history'][number]): string {
  if (entry.type === 'comment') return 'COMMENT';
  if (entry.type === 'field_change') return `CHANGE (${toSingleLine(String(entry.field))})`;
  return 'STATUS CHANGE';
}

const formatDate = (value: string) => toSingleLine(new Date(value).toLocaleString());

const renderUntrusted = (content: string, ctx: RenderContext) =>
  wrapUntrusted(addFrameLinksToContent(content, ctx.frameCounts), ctx.nonce);

function buildDescriptionSection(task: JiraTaskData, ctx: RenderContext): string {
  if (!task.description?.trim()) return '';
  return `## Description\n\n${renderUntrusted(task.description, ctx)}\n\n`;
}

function buildHistorySection(
  task: JiraTaskData,
  ctx: RenderContext,
  options: Partial<ExportOptions>
): string {
  const withStatusChanges = options.withStatusChanges ?? true;
  const withComments = options.withComments ?? true;
  const history = task.history.filter((entry) =>
    entry.type === 'comment' ? withComments : withStatusChanges
  );
  if (history.length === 0) return '';
  const entries = history.map(
    (entry) =>
      `---\n[${historyLabel(entry)}] ${toSingleLine(entry.author)} — ${formatDate(entry.date)}:\n` +
      `${renderUntrusted(entry.content, ctx)}\n\n`
  );
  return `${withStatusChanges ? '## History' : '## Comments'}\n\n${entries.join('')}`;
}

function buildWorklogEntry(
  worklog: NonNullable<JiraTaskData['worklogs']>[number],
  ctx: RenderContext
): string {
  const header = `---\n[WORKLOG] ${toSingleLine(worklog.author)} — ${formatDate(worklog.started)}: ${toSingleLine(worklog.timeSpent)}\n`;
  if (!worklog.comment) return `${header}\n`;
  return `${header}${renderUntrusted(worklog.comment, ctx)}\n\n`;
}

function buildWorklogSection(task: JiraTaskData, ctx: RenderContext): string {
  if (!task.worklogs?.length) return '';
  return `## Worklog\n\n${task.worklogs.map((worklog) => buildWorklogEntry(worklog, ctx)).join('')}`;
}

type ConfluenceRender = {
  section: string;
  resolve: (ref: ConfluenceRef) => ResolvedConfluenceRef | undefined;
};

function buildTaskMarkdown(
  task: JiraTaskData,
  ctx: RenderContext,
  options: Partial<ExportOptions> = {},
  confluence?: ConfluenceRender
): string {
  const frontmatterBody = buildFrontmatterBlock(task, ctx.selectedKeys);
  let md =
    `---\n${frontmatterBody}\n---\n\n${untrustedNotice(ctx.nonce)}\n\n# ${toSingleLine(task.title)}\n\n` +
    buildDescriptionSection(task, ctx) +
    (confluence?.section ?? '') +
    buildHistorySection(task, ctx, options) +
    buildWorklogSection(task, ctx);

  if (options.outputDir && options.localIssueLinks !== false) {
    md = linkLocalIssues(md, {
      outputDir: options.outputDir,
      selfKey: task.key,
      batchKeys: options.batchKeys,
    });
  }
  if (confluence) md = rewriteConfluenceLinks(md, confluence.resolve);
  return md;
}

// The notice line directly under the frontmatter. Frontmatter values are escaped onto one line,
// so Jira text cannot end the frontmatter early and plant a notice of its own.
const NONCE_IN_NOTICE = /^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n> Text between `<<<jira-data ([0-9a-f]{16})>>>`/;

/**
 * The nonce of an earlier export of the same issue, so an unchanged issue re-exports to the
 * same bytes (watch and the UI diff compare task.md with its previous copy). Only local files
 * carry it, so reusing it does not let a Jira user predict the markers.
 */
function previousNonce(previous: string | null): string | undefined {
  return previous ? NONCE_IN_NOTICE.exec(previous)?.[1] : undefined;
}

function durationSkipReason(probe: VideoDurationProbe, maxSeconds: number): string | undefined {
  if (probe.status !== 'known') return undefined;
  if (probe.seconds <= maxSeconds) return undefined;
  return `video duration ${Math.round(probe.seconds)}s exceeds the ${maxSeconds}s limit`;
}

function prepareTaskDir(outputDir: string, taskDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  ensureRealDirectory(taskDir);
  assertRealPathInside(outputDir, taskDir);
}

const FRAME_ARTIFACT_RE = /^(frame-\d+|raw-(\d+|first|last))\.[a-z0-9]+$/i;

function prepareFramesDir(framesDir: string): void {
  assertNotSymlink(framesDir);
  if (!entryExists(framesDir)) return;
  if (!isRealDirectory(framesDir)) {
    throw new Error(`Refusing to extract frames: ${framesDir} is not a directory`);
  }
  readdirSync(framesDir)
    .filter((name) => FRAME_ARTIFACT_RE.test(name))
    .forEach((name) => removeEntry(join(framesDir, name)));
}

function writeGitignore(outputDir: string): void {
  const gitignorePath = join(outputDir, '.gitignore');
  if (entryExists(gitignorePath)) return;
  try {
    writeFileSync(gitignorePath, '*\n', { encoding: 'utf-8', flag: 'wx' });
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }
}

const isAlreadyExistsError = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST';

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

type VideoFrameSettings = {
  fps: number;
  quality: number;
  maxFrames: number;
  maxDurationSeconds?: number;
};

async function extractVideoFrames(
  attPath: string,
  attachmentsDir: string,
  filename: string,
  settings: VideoFrameSettings
): Promise<VideoExtractionInfo> {
  const maxSeconds = settings.maxDurationSeconds ?? DEFAULT_MAX_VIDEO_DURATION_SECONDS;
  const skipReason = durationSkipReason(await readVideoDuration(attPath), maxSeconds);
  if (skipReason) {
    console.warn(`  ⚠ ${filename}: skipping frame extraction, ${skipReason}`);
    return {
      filename,
      frameCount: 0,
      dedupedCount: 0,
      error: `Frame extraction skipped: ${skipReason}`,
    };
  }

  const framesDir = resolveContainedPath(attachmentsDir, framesDirName(filename));
  prepareFramesDir(framesDir);
  console.log(
    `  🎬 ${filename}: extracting frames (fps=${settings.fps}, max=${settings.maxFrames})...`
  );
  try {
    const result = await extractFrames(attPath, framesDir, {
      fps: settings.fps,
      format: 'jpeg',
      quality: settings.quality,
      maxFrames: settings.maxFrames,
    });
    console.log(
      `  ✓ ${filename}: extracted ${result.extractedCount} frames, kept ${result.keptCount}`
    );
    return { filename, frameCount: result.extractedCount, dedupedCount: result.keptCount };
  } catch (error: unknown) {
    const msg = errorMessage(error);
    console.warn(`  ⚠ ${filename}: ${msg}`);
    return { filename, frameCount: 0, dedupedCount: 0, error: msg };
  }
}

function enqueueParent(queue: QueueEntry[], parentKey: string): void {
  if (!isSafeIssueKey(parentKey)) {
    console.warn(`Skipping parent with invalid issue key ${JSON.stringify(parentKey)}`);
    return;
  }
  queue.push({ key: parentKey, requested: false });
}

export class JiraExporter {
  private client: JiraClient;

  private baseUrl: string;
  private config: JiraConfig;
  private apiToken: string;

  constructor(config: JiraConfig, apiToken: string) {
    this.client = new JiraClient(config, apiToken);
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.config = config;
    this.apiToken = apiToken;
  }

  private confluenceRun(options: ExportOptions): ConfluenceRun | undefined {
    if (options.withConfluence === false) return undefined;
    let jiraOrigin = '';
    try {
      jiraOrigin = new URL(this.baseUrl).origin.toLowerCase();
    } catch {
      // An unusable base URL fails the Jira calls anyway.
    }
    return new ConfluenceRun(
      options,
      { userEmail: this.config.userEmail, apiToken: this.apiToken, jiraOrigin },
      this.config.redirects
    );
  }

  async exportIssue(
    issueKey: string,
    options: ExportOptions,
    context: { expandLinks?: boolean; confluence?: ConfluenceRun } = {}
  ): Promise<ExportIssueOutcome> {
    const customFieldDefs = options.customFieldDefs ?? {};
    const resolved = resolveFieldSet(options.fieldSelector, customFieldDefs);

    const task = await this.client.fetchIssueDetails(issueKey, {
      jiraFieldIds: resolved.jiraFieldIds,
      customFieldDefs,
      fullChangelog: options.withHistory ?? false,
      includeWorklog: options.withWorklog ?? false,
    });

    if (!isSafeIssueKey(task.key)) {
      throw new Error(
        `Refusing to export: Jira returned an invalid issue key ${JSON.stringify(task.key)}`
      );
    }

    // On unless switched off: a sub-task (e.g. the FE part of a BE story) is not an
    // issue link, so without this it is missing from the export entirely.
    if (options.includeSubtasks !== false && resolved.friendlyKeys.includes('subtasks')) {
      task.subtasks = await this.client.fetchIssueSubtasks(task.key);
    }

    const taskDir = join(options.outputDir, task.key.toLowerCase());
    const existed = entryExists(taskDir);
    prepareTaskDir(options.outputDir, taskDir);

    const attachmentsDir = join(taskDir, ATTACHMENTS_DIR);
    const attachmentNames = assignAttachmentFilenames(task.attachments);
    const taskMdPath = join(taskDir, TASK_MD);
    const previousContent = isRegularFile(taskMdPath) ? readFileSync(taskMdPath, 'utf-8') : null;
    const linkedKeys = linkedIssueKeys(task, this.baseUrl).filter(isSafeIssueKey);
    // Linked issues about to be exported in this run already count as local copies.
    const writeOptions = context.expandLinks
      ? { ...options, batchKeys: [...(options.batchKeys ?? []), ...linkedKeys] }
      : options;
    const baseContext = {
      selectedKeys: new Set(resolved.friendlyKeys),
      nonce: previousNonce(previousContent) ?? createNonce(),
    };
    let confluenceRender: ConfluenceRender | undefined;
    const render = () =>
      buildTaskMarkdown(
        task,
        { ...baseContext, frameCounts: readFrameCounts(attachmentsDir, attachmentNames) },
        writeOptions,
        confluenceRender
      );

    // Confluence pages the issue links to are exported first so task.md can link their copies.
    const confluence = context.confluence ?? this.confluenceRun(options);
    if (confluence) {
      const items: ConfluenceItem[] = [];
      // Pages attached through the issue's "Confluence content" panel (e.g. test reports) are
      // remote links, not text in the description.
      const remoteUrls = await Promise.resolve()
        .then(() => this.client.getRemoteLinkUrls(task.key))
        .catch(() => [] as string[]);
      for (const ref of confluence.refsIn([render(), ...remoteUrls].join('\n'))) {
        items.push(await confluence.fetch(ref, ref.url, task.key, writeOptions.batchKeys ?? []));
      }
      const resolve = (ref: ConfluenceRef) => confluence.resolve(ref, `../${CONFLUENCE_DIR}/`);
      confluenceRender = { section: confluenceSection(items, resolve), resolve };
    }

    const initialContent = render();
    writeFileAtomic(taskMdPath, initialContent);

    const videos =
      task.attachments.length > 0
        ? await this.exportAttachments(task, attachmentsDir, attachmentNames, options)
        : [];

    const finalContent = render();
    if (finalContent !== initialContent) writeFileAtomic(taskMdPath, finalContent);
    // Keep the replaced copy so a reader can diff what changed since the last export.
    if (previousContent !== null && previousContent !== finalContent) {
      writeFileAtomic(join(taskDir, '.task.previous.md'), previousContent);
    }

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

  private async exportAttachments(
    task: JiraTaskData,
    attachmentsDir: string,
    attachmentNames: readonly string[],
    options: ExportOptions
  ): Promise<VideoExtractionInfo[]> {
    ensureRealDirectory(attachmentsDir);
    console.log(`  ↓ ${task.key}: downloading ${task.attachments.length} attachment(s)...`);

    const videos: VideoExtractionInfo[] = [];
    const processedVideos = new Set<string>();

    for (const [index, att] of task.attachments.entries()) {
      const filename = attachmentNames[index];
      const attPath = resolveContainedPath(attachmentsDir, filename);
      await this.ensureAttachment(att.url, attPath);

      const videoKey = `${task.key}:${att.id}`;
      if (!options.videoFrames?.enabled || !isVideoFile(filename) || processedVideos.has(videoKey)) {
        continue;
      }
      processedVideos.add(videoKey);
      videos.push(
        await extractVideoFrames(attPath, attachmentsDir, filename, {
          ...DEFAULT_VIDEO_OPTS,
          ...options.videoFrames,
        })
      );
    }

    return videos;
  }

  private async ensureAttachment(url: string, attPath: string): Promise<void> {
    assertNotSymlink(attPath);
    if (isRegularFile(attPath)) return;
    await writeViaTempFile(attPath, (tempPath) => this.client.downloadAttachment(url, tempPath));
  }

  async exportIssues(issueKeys: string[], options: ExportOptions): Promise<ExportResult> {
    const result: ExportResult = {
      imported: [],
      updated: [],
      failed: [],
      cancelled: [],
      confluence: [],
    };
    const confluence = this.confluenceRun(options);

    mkdirSync(options.outputDir, { recursive: true });
    writeGitignore(options.outputDir);

    const seen = new Set<string>();
    const queue: QueueEntry[] = issueKeys.map((key) => ({ key, requested: true }));
    // Every issue this run will try to write; links between them are local.
    const runKeys = new Set(
      [...issueKeys, ...(options.batchKeys ?? [])].map((k) => k.toUpperCase())
    );
    const written: string[] = [];
    const failedLinked: string[] = [];

    for (let i = 0; i < queue.length; i++) {
      const { key, requested, via } = queue[i];
      const dedupeKey = key.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      if (options.signal?.aborted) {
        result.cancelled.push(key);
        continue;
      }

      try {
        options.onIssueStart?.(key, { requested, via });
        const expandLinks = Boolean(options.includeLinked && requested);
        const outcome = await this.exportIssue(
          key,
          { ...options, batchKeys: [...runKeys] },
          { expandLinks, confluence }
        );
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
          enqueueParent(queue, outcome.parentKey);
        }
        if (expandLinks) {
          for (const linked of outcome.linkedKeys) {
            runKeys.add(linked);
            queue.push({ key: linked, requested: false, via: outcome.canonicalKey });
          }
        }
      } catch (error) {
        const message = errorMessage(error);
        options.onIssueFailed?.(key, { requested, via, error: message });
        if (!requested) {
          const what = via ? `linked issue (from ${via})` : 'parent';
          console.warn(`Failed to fetch ${what} ${key}: ${message}`);
          if (via) failedLinked.push(key);
          continue;
        }
        result.failed.push({ key, error: message });
      }
    }

    // Linked issues that could not be fetched (or were cancelled) were already linked locally;
    // point those links back at Jira unless an earlier export left a local copy.
    const missing = [...failedLinked, ...result.cancelled].filter(
      (key) => !existsSync(join(options.outputDir, key.toLowerCase(), TASK_MD))
    );
    if (missing.length > 0) {
      for (const path of written) {
        const content = readFileSync(path, 'utf-8');
        let next = content;
        for (const key of missing) {
          const local = `](../${key.toLowerCase()}/task.md)`;
          next = next.split(local).join(`](${this.baseUrl}/browse/${key})`);
        }
        if (next !== content) writeFileAtomic(path, next);
      }
    }

    result.confluence = confluence?.all() ?? [];
    return result;
  }
}
