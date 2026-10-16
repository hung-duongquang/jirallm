import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { convertADFToMarkdown } from './adfToMarkdown.js';
import { linkLocalIssues } from './issueLinks.js';
import { collectConfluenceRefs, confluenceRefKey, rewriteConfluenceLinks, } from './confluenceLinks.js';
import { JiraApiError, requestWithRedirectPolicy } from './jiraClient.js';
/** Folder (inside the export folder) that holds the exported Confluence pages. */
export const CONFLUENCE_DIR = 'confluence';
/** Read-only Confluence Cloud REST client (v2 API) for one site. */
export class ConfluenceClient {
    origin;
    redirects;
    wiki;
    authHeader;
    constructor(origin, userEmail, apiToken, redirects) {
        this.origin = origin;
        this.redirects = redirects;
        this.wiki = `${origin.replace(/\/+$/, '')}/wiki`;
        this.authHeader = `Basic ${Buffer.from(`${userEmail}:${apiToken}`).toString('base64')}`;
    }
    async getJson(pathOrUrl) {
        const url = pathOrUrl.startsWith('/wiki/')
            ? `${this.wiki}${pathOrUrl.slice('/wiki'.length)}`
            : `${this.wiki}${pathOrUrl}`;
        const response = await requestWithRedirectPolicy(url, { headers: { Authorization: this.authHeader, Accept: 'application/json' } }, this.redirects);
        if (!response.ok)
            throw await JiraApiError.fromResponse(response, 'Confluence API request failed');
        return response.json();
    }
    async getPage(id) {
        const page = await this.getJson(`/api/v2/pages/${encodeURIComponent(id)}?body-format=atlas_doc_format`);
        const raw = page.body?.atlas_doc_format?.value;
        let adf = null;
        if (raw) {
            try {
                adf = JSON.parse(raw);
            }
            catch {
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
    async getWhiteboardTitle(id) {
        const board = await this.getJson(`/api/v2/whiteboards/${encodeURIComponent(id)}`);
        return board.title;
    }
    async listAttachments(pageId) {
        const all = [];
        let next = `/api/v2/pages/${encodeURIComponent(pageId)}/attachments?limit=250`;
        // Bounded so a misbehaving cursor cannot loop forever (250 × 40 = 10 000 attachments).
        for (let page = 0; next && page < 40; page++) {
            const body = await this.getJson(next);
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
    async downloadAttachment(downloadLink, outputPath) {
        const response = await requestWithRedirectPolicy(`${this.wiki}${downloadLink}`, { headers: { Authorization: this.authHeader } }, this.redirects);
        if (!response.ok || !response.body) {
            throw new Error(`Failed to download attachment: ${response.status} ${response.statusText}`);
        }
        await pipeline(response.body, createWriteStream(outputPath));
    }
}
/** Lowercase, dash-separated, at most 60 characters: `ion-check-and-registrations`. */
export function slugify(title) {
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
export function safeFilename(name) {
    const cleaned = name
        .replace(/[<>:"/\\|?*\s()[\]#%]+/g, '_')
        .replace(/\p{Cc}+/gu, '_')
        .replace(/^\.+/, '_');
    return cleaned || 'attachment';
}
/** The folder of an earlier export of this page (`<id>-<slug>`), whatever its title was then. */
export function findLocalPageDir(outputDir, pageId) {
    const root = join(outputDir, CONFLUENCE_DIR);
    if (!existsSync(root))
        return undefined;
    const name = readdirSync(root).find((entry) => entry === pageId || entry.startsWith(`${pageId}-`));
    return name && existsSync(join(root, name, 'page.md')) ? name : undefined;
}
function mediaFileIds(adf) {
    const ids = new Set();
    const walk = (node) => {
        if (!node || typeof node !== 'object')
            return;
        if ((node.type === 'media' || node.type === 'mediaInline') && typeof node.attrs?.id === 'string') {
            ids.add(node.attrs.id);
        }
        if (Array.isArray(node.content))
            node.content.forEach(walk);
    };
    adf?.content?.forEach(walk);
    return ids;
}
const yamlString = (value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
/**
 * Writes a page to `<outputDir>/confluence/<id>-<slug>/page.md` with the attachments it
 * shows in `attachments/`. Attachments already on disk are not downloaded again.
 */
export async function exportConfluencePage(client, pageId, context) {
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
            if (!existsSync(target))
                await client.downloadAttachment(file.downloadLink, target);
        }
    }
    let body = convertADFToMarkdown(page.adf, files.map((file) => ({ id: file.fileId, filename: file.filename })));
    if (context.localIssueLinks !== false) {
        body = linkLocalIssues(body, {
            outputDir: context.outputDir,
            batchKeys: context.batchKeys,
            pathToOutputDir: '../../',
        });
    }
    const self = { origin: client.origin, kind: 'page', id: page.id };
    await context.lookupRefs?.(collectConfluenceRefs(body).filter((ref) => confluenceRefKey(ref) !== confluenceRefKey(self)));
    body = rewriteConfluenceLinks(body, (ref) => confluenceRefKey(ref) === confluenceRefKey(self) ? undefined : context.resolveRef?.(ref));
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
    if (previous !== content)
        writeFileSync(path, content, 'utf-8');
    const status = previous === null ? 'new' : previous === content ? 'unchanged' : 'changed';
    return { id: page.id, title: page.title, dirName, path, status, attachmentCount: files.length };
}
//# sourceMappingURL=confluence.js.map