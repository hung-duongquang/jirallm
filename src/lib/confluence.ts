import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { convertADFToMarkdown, type JiraADFContent, type JiraADFDocument } from './adfToMarkdown.js';
import { linkLocalIssues } from './issueLinks.js';
import {
  collectConfluenceRefs,
  confluenceRefKey,
  rewriteConfluenceLinks,
  type ConfluenceRef,
} from './confluenceLinks.js';
import { JiraApiError, requestWithRedirectPolicy, type RedirectPolicy } from './jiraClient.js';

/** Folder (inside the export folder) that holds the exported Confluence pages. */
export const CONFLUENCE_DIR = 'confluence';

export type ConfluencePage = {
  id: string;
  title: string;
  version: number;
  updatedAt?: string;
  webUrl: string;
  adf: JiraADFDocument | null;
};

export type ConfluenceAttachment = {
  fileId: string;
  title: string;
  mediaType?: string;
  /** Path relative to `<origin>/wiki`. */
  downloadLink: string;
};

/** Read-only Confluence Cloud REST client (v2 API) for one site. */
export class ConfluenceClient {
  private readonly wiki: string;
  private readonly authHeader: string;

  constructor(
    readonly origin: string,
    userEmail: string,
    apiToken: string,
    private readonly redirects?: RedirectPolicy
  ) {
    this.wiki = `${origin.replace(/\/+$/, '')}/wiki`;
    this.authHeader = `Basic ${Buffer.from(`${userEmail}:${apiToken}`).toString('base64')}`;
  }

  private async getJson<T>(pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith('/wiki/')
      ? `${this.wiki}${pathOrUrl.slice('/wiki'.length)}`
      : `${this.wiki}${pathOrUrl}`;
    const response = await requestWithRedirectPolicy(
      url,
      { headers: { Authorization: this.authHeader, Accept: 'application/json' } },
      this.redirects
    );
    if (!response.ok) throw await JiraApiError.fromResponse(response, 'Confluence API request failed');
    return response.json() as Promise<T>;
  }

  private async send<T>(method: string, path: string, body: unknown): Promise<T> {
    const response = await requestWithRedirectPolicy(
      `${this.wiki}${path}`,
      {
        method,
        headers: { Authorization: this.authHeader, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      this.redirects
    );
    if (!response.ok) throw await JiraApiError.fromResponse(response, 'Confluence API request failed');
    return response.json() as Promise<T>;
  }

  /** Server-side conversion, so tables, images and links render as Confluence's own markup. */
  async wikiToStorage(wiki: string): Promise<string> {
    const res = await this.send<{ value: string }>('POST', '/rest/api/contentbody/convert/storage', {
      value: wiki,
      representation: 'wiki',
    });
    return res.value;
  }

  /** Creates the page, or updates it (next version) when `pageId` is given. Returns id + web URL. */
  async savePage(page: {
    pageId?: string;
    spaceKey: string;
    parentId?: string;
    title: string;
    storage: string;
  }): Promise<{ id: string; url: string; version: number }> {
    const body = { type: 'page', title: page.title, body: { storage: { value: page.storage, representation: 'storage' } } };
    type Saved = { id: string; version: { number: number }; _links: { base: string; webui: string } };
    let saved: Saved;
    if (page.pageId) {
      const current = await this.getJson<{ version: { number: number } }>(`/rest/api/content/${page.pageId}`);
      saved = await this.send<Saved>('PUT', `/rest/api/content/${page.pageId}`, {
        ...body,
        version: { number: current.version.number + 1 },
      });
    } else {
      saved = await this.send<Saved>('POST', '/rest/api/content', {
        ...body,
        space: { key: page.spaceKey },
        ...(page.parentId ? { ancestors: [{ id: page.parentId }] } : {}),
      });
    }
    return { id: saved.id, url: `${saved._links.base}${saved._links.webui}`, version: saved.version.number };
  }

  /** Uploads a file; a file with the same name becomes a new version of that attachment. */
  async uploadAttachment(pageId: string, filename: string, data: Buffer): Promise<void> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)]), filename);
    form.append('minorEdit', 'true');
    const response = await requestWithRedirectPolicy(
      `${this.wiki}/rest/api/content/${pageId}/child/attachment`,
      { method: 'PUT', headers: { Authorization: this.authHeader, 'X-Atlassian-Token': 'no-check' }, body: form },
      this.redirects
    );
    if (!response.ok) throw await JiraApiError.fromResponse(response, 'Confluence attachment upload failed');
  }

  async getPage(id: string): Promise<ConfluencePage> {
    const page = await this.getJson<{
      id: string;
      title: string;
      version?: { number?: number; createdAt?: string };
      body?: { atlas_doc_format?: { value?: string } };
      _links?: { webui?: string; base?: string };
    }>(`/api/v2/pages/${encodeURIComponent(id)}?body-format=atlas_doc_format`);
    const raw = page.body?.atlas_doc_format?.value;
    let adf: JiraADFDocument | null = null;
    if (raw) {
      try {
        adf = JSON.parse(raw) as JiraADFDocument;
      } catch {
        adf = null;
      }
    }
    return {
      id: String(page.id),
      title: page.title,
      version: page.version?.number ?? 0,
      updatedAt: page.version?.createdAt,
      webUrl: `${page._links?.base ?? this.wiki}${page._links?.webui ?? `/pages/viewpage.action?pageId=${id}`}`,
      adf,
    };
  }

  async getWhiteboardTitle(id: string): Promise<string> {
    const board = await this.getJson<{ title: string }>(
      `/api/v2/whiteboards/${encodeURIComponent(id)}`
    );
    return board.title;
  }

  async listAttachments(pageId: string): Promise<ConfluenceAttachment[]> {
    const all: ConfluenceAttachment[] = [];
    let next: string | undefined = `/api/v2/pages/${encodeURIComponent(pageId)}/attachments?limit=250`;
    // Bounded so a misbehaving cursor cannot loop forever (250 × 40 = 10 000 attachments).
    for (let page = 0; next && page < 40; page++) {
      const body: {
        results?: Array<{ fileId?: string; title?: string; mediaType?: string; downloadLink?: string }>;
        _links?: { next?: string };
      } = await this.getJson(next);
      for (const att of body.results ?? []) {
        if (att.fileId && att.title && att.downloadLink) {
          all.push({
            fileId: att.fileId,
            title: att.title,
            mediaType: att.mediaType,
            downloadLink: att.downloadLink,
          });
        }
      }
      next = body._links?.next;
    }
    return all;
  }

  async downloadAttachment(downloadLink: string, outputPath: string): Promise<void> {
    const response = await requestWithRedirectPolicy(
      `${this.wiki}${downloadLink}`,
      { headers: { Authorization: this.authHeader } },
      this.redirects
    );
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download attachment: ${response.status} ${response.statusText}`);
    }
    await pipeline(response.body as unknown as NodeJS.ReadableStream, createWriteStream(outputPath));
  }
}

/** Lowercase, dash-separated, at most 60 characters: `ion-check-and-registrations`. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'page';
}

/** A filename that is valid on every OS and needs no escaping in a Markdown link. */
export function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\s()[\]#%]+/g, '_')
    .replace(/\p{Cc}+/gu, '_')
    .replace(/^\.+/, '_');
  return cleaned || 'attachment';
}

/** The folder of an earlier export of this page (`<id>-<slug>`), whatever its title was then. */
export function findLocalPageDir(outputDir: string, pageId: string): string | undefined {
  const root = join(outputDir, CONFLUENCE_DIR);
  if (!existsSync(root)) return undefined;
  const name = readdirSync(root).find((entry) => entry === pageId || entry.startsWith(`${pageId}-`));
  return name && existsSync(join(root, name, 'page.md')) ? name : undefined;
}

function mediaFileIds(adf: JiraADFDocument | null): Set<string> {
  const ids = new Set<string>();
  const walk = (node: JiraADFContent | undefined) => {
    if (!node || typeof node !== 'object') return;
    if ((node.type === 'media' || node.type === 'mediaInline') && typeof node.attrs?.id === 'string') {
      ids.add(node.attrs.id);
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  adf?.content?.forEach(walk);
  return ids;
}

const yamlString = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export type ExportedPage = {
  id: string;
  title: string;
  /** Folder name below `<outputDir>/confluence/`. */
  dirName: string;
  path: string;
  status: 'new' | 'changed' | 'unchanged';
  attachmentCount: number;
};

export type PageExportContext = {
  outputDir: string;
  /** Jira issues with a local copy in this run (see `linkLocalIssues`). */
  batchKeys?: string[];
  localIssueLinks?: boolean;
  /** Other Confluence items known in this run, so links between them can be local. */
  resolveRef?: (ref: ConfluenceRef) => { title: string; path?: string } | undefined;
  /** Called with the items the page links to before its links are rewritten. */
  lookupRefs?: (refs: Array<ConfluenceRef & { url: string }>) => Promise<void>;
};

/**
 * Writes a page to `<outputDir>/confluence/<id>-<slug>/page.md` with the attachments it
 * shows in `attachments/`. Attachments already on disk are not downloaded again.
 */
export async function exportConfluencePage(
  client: ConfluenceClient,
  pageId: string,
  context: PageExportContext
): Promise<ExportedPage> {
  const page = await client.getPage(pageId);
  const dirName = findLocalPageDir(context.outputDir, page.id) ?? `${page.id}-${slugify(page.title)}`;
  const pageDir = join(context.outputDir, CONFLUENCE_DIR, dirName);
  mkdirSync(pageDir, { recursive: true });

  const shown = mediaFileIds(page.adf);
  const attachments = shown.size > 0
    ? (await client.listAttachments(page.id)).filter((att) => shown.has(att.fileId))
    : [];
  const files = attachments.map((att) => ({ ...att, filename: safeFilename(att.title) }));
  if (files.length > 0) {
    const attachmentsDir = join(pageDir, 'attachments');
    mkdirSync(attachmentsDir, { recursive: true });
    for (const file of files) {
      const target = join(attachmentsDir, file.filename);
      if (!existsSync(target)) await client.downloadAttachment(file.downloadLink, target);
    }
  }

  let body = convertADFToMarkdown(
    page.adf,
    files.map((file) => ({ id: file.fileId, filename: file.filename }))
  );
  if (context.localIssueLinks !== false) {
    body = linkLocalIssues(body, {
      outputDir: context.outputDir,
      batchKeys: context.batchKeys,
      pathToOutputDir: '../../',
    });
  }
  const self = { origin: client.origin, kind: 'page' as const, id: page.id };
  await context.lookupRefs?.(
    collectConfluenceRefs(body).filter((ref) => confluenceRefKey(ref) !== confluenceRefKey(self))
  );
  body = rewriteConfluenceLinks(body, (ref) =>
    confluenceRefKey(ref) === confluenceRefKey(self) ? undefined : context.resolveRef?.(ref)
  );

  const frontmatter = [
    'confluence:',
    `  id: ${yamlString(page.id)}`,
    `  title: ${yamlString(page.title)}`,
    `  version: ${page.version}`,
    ...(page.updatedAt ? [`  updatedAt: ${yamlString(page.updatedAt)}`] : []),
    `  url: ${yamlString(page.webUrl)}`,
  ].join('\n');
  const content = `---\n${frontmatter}\n---\n\n# ${page.title}\n\n${body.trim()}\n`;

  const path = join(pageDir, 'page.md');
  const previous = existsSync(path) ? readFileSync(path, 'utf-8') : null;
  if (previous !== content) writeFileSync(path, content, 'utf-8');
  const status = previous === null ? 'new' : previous === content ? 'unchanged' : 'changed';
  return { id: page.id, title: page.title, dirName, path, status, attachmentCount: files.length };
}
