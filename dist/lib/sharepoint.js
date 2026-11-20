import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import TurndownService from 'turndown';
import gfmPlugin from 'turndown-plugin-gfm';
import { parse } from 'node-html-parser';
import { getSecret } from './credentials.js';
export const SHAREPOINT_COOKIE_ACCOUNT = 'sharepoint:cookie';
export const SHAREPOINT_URL_ACCOUNT = 'sharepoint:url';
export const SHAREPOINT_NOT_SET_UP = 'SharePoint not set up (no session cookie): skipped. `jirallm sharepoint:auth` enables it.';
/**
 * Takes what the user pasted from the browser — a Cookie header value, a `Cookie:` line, or a whole
 * "Copy as cURL" command — and keeps only the SharePoint session cookies (FedAuth, rtFa).
 */
export function parseCookieInput(input) {
    let text = input.trim();
    const curl = /(?:-H|--header)\s+(['"])cookie:\s*([\s\S]*?)\1/i.exec(text) ??
        /(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/.exec(text) ??
        // "Copy as fetch (Node.js)": "cookie": "…" in the headers object
        /(["'])cookie\1\s*:\s*"([^"]*)"/i.exec(text);
    if (curl)
        text = curl[2];
    text = text.replace(/^cookie:\s*/i, '');
    const wanted = new Map();
    for (const part of text.split(/;\s*/)) {
        const eq = part.indexOf('=');
        if (eq < 1)
            continue;
        const name = part.slice(0, eq).trim();
        if (name === 'FedAuth' || name === 'rtFa')
            wanted.set(name, part.slice(eq + 1).trim());
    }
    if (!wanted.has('FedAuth'))
        throw new Error('No FedAuth cookie found. Paste the Cookie header (or "Copy as cURL") of a request to your SharePoint site.');
    return [...wanted].map(([k, v]) => `${k}=${v}`).join('; ');
}
/** The site origin from a URL or a cURL command that contains one. */
export function parseOrigin(input) {
    const m = /https:\/\/[a-z0-9-]+\.sharepoint\.com/i.exec(input);
    return m ? m[0].toLowerCase() : undefined;
}
export async function hasSharePointAuth() {
    return Boolean(await getSecret(SHAREPOINT_COOKIE_ACCOUNT, 'SHAREPOINT_COOKIE'));
}
export async function loadSharePointAuth(urlHint) {
    const cookie = await getSecret(SHAREPOINT_COOKIE_ACCOUNT, 'SHAREPOINT_COOKIE');
    if (!cookie)
        throw new Error('No SharePoint session. Run `jirallm sharepoint:auth` (or set SHAREPOINT_COOKIE).');
    const origin = (urlHint && parseOrigin(urlHint)) ?? parseOrigin((await getSecret(SHAREPOINT_URL_ACCOUNT, 'SHAREPOINT_URL')) ?? '');
    if (!origin)
        throw new Error('No SharePoint site known. Run `jirallm sharepoint:auth` or pass a full https://<tenant>.sharepoint.com URL.');
    return { cookie: parseCookieInput(cookie), origin };
}
/** Splits a modern page URL (`…/sites/<site>/SitePages/<path>.aspx`) into its web and file path. */
export function parseSharePointPageUrl(url) {
    let u;
    try {
        u = new URL(url);
    }
    catch {
        throw new Error(`Not a URL: ${url}`);
    }
    if (!/\.sharepoint\.com$/i.test(u.hostname))
        throw new Error(`Not a SharePoint URL: ${url}`);
    const path = decodeURIComponent(u.pathname);
    const at = path.toLowerCase().indexOf('/sitepages/');
    if (at < 0 || !path.toLowerCase().endsWith('.aspx'))
        throw new Error(`Not a SharePoint page URL (expected …/SitePages/<page>.aspx): ${url}`);
    const webPath = path.slice(0, at);
    const site = webPath.split('/').filter(Boolean).at(-1) ?? 'root';
    return {
        origin: u.origin.toLowerCase(),
        webUrl: u.origin + encodeURI(webPath),
        serverRelativePath: path,
        fileName: path.slice(at + '/SitePages/'.length),
        site,
    };
}
export class SharePointSessionError extends Error {
}
export class SharePointClient {
    auth;
    fetchImpl;
    constructor(auth, fetchImpl = fetch) {
        this.auth = auth;
        this.fetchImpl = fetchImpl;
    }
    get origin() {
        return this.auth.origin;
    }
    async request(url, accept) {
        const res = await this.fetchImpl(url, { headers: { Cookie: this.auth.cookie, Accept: accept }, redirect: 'manual' });
        if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
            throw new SharePointSessionError(`SharePoint refused the session (${res.status}) for ${url}. The cookie has probably expired: sign in again in the browser and re-run \`jirallm sharepoint:auth\`.`);
        }
        return res;
    }
    async json(url) {
        const res = await this.request(url, 'application/json;odata=nometadata');
        const body = await res.text();
        if (!res.ok) {
            let msg = body.slice(0, 300);
            try {
                const e = JSON.parse(body);
                msg = e['odata.error']?.message?.value ?? msg;
            }
            catch {
                // not JSON
            }
            throw new Error(`SharePoint ${res.status}: ${msg}`);
        }
        return JSON.parse(body);
    }
    async download(url) {
        let res = await this.request(url, '*/*');
        // A plain file URL can 404 where the REST file endpoint of its own site still serves it.
        const fallback = !res.ok ? fileValueUrl(url) : undefined;
        if (fallback)
            res = await this.request(fallback, '*/*');
        if (!res.ok)
            throw new Error(`Download failed (${res.status}): ${url}`);
        return Buffer.from(await res.arrayBuffer());
    }
}
/** `…/sites/<site>/<path>` → that site's `GetFileByServerRelativePath(…)/$value` URL. */
function fileValueUrl(url) {
    try {
        const u = new URL(url);
        const path = decodeURIComponent(u.pathname);
        const site = /^\/(?:sites|teams)\/[^/]+/.exec(path)?.[0];
        if (!site || u.pathname.includes('/_api/') || u.pathname.includes('/_layouts/'))
            return undefined;
        return `${u.origin}${encodeURI(site)}/_api/web/GetFileByServerRelativePath(decodedurl=@u)/$value?@u=${odataString(path)}`;
    }
    catch {
        return undefined;
    }
}
/** OData string literal for a parameter alias: quotes doubled, then URL-encoded. */
function odataString(value) {
    return `'${encodeURIComponent(value.replace(/'/g, "''"))}'`;
}
export async function fetchSharePointPage(client, link) {
    const base = `${link.webUrl}/_api/web/GetFileByServerRelativePath(decodedurl=@u)/ListItemAllFields`;
    const select = 'Id,Title,Description,Modified,FirstPublishedDate,PromotedState,CanvasContent1,FieldValuesAsText/Author,FieldValuesAsText/Editor';
    const item = await client.json(`${base}?$select=${select}&$expand=FieldValuesAsText&@u=${odataString(link.serverRelativePath)}`);
    if (!item.CanvasContent1) {
        // Classic wiki pages keep their body in WikiField; modern pages may not have the column at all.
        try {
            const wiki = await client.json(`${base}?$select=WikiField&@u=${odataString(link.serverRelativePath)}`);
            item.WikiField = wiki.WikiField;
        }
        catch {
            // no WikiField column
        }
    }
    return item;
}
const WP = {
    spacer: '8654b779-4886-46d4-8ffb-b5ed960ee986',
    divider: '2161a1c6-db61-4731-b97c-3cdb303f7cbb',
    banner: 'cbe7b0a9-3504-44dd-a3a3-0e5cacd07788',
    image: 'd1d91016-032f-456d-98a4-721247c305e8',
    embed: '490d7c76-1824-45b2-9de3-676421c997fa',
    involvCallToAction: 'd5f735d3-274a-4a18-998b-04dede36c861',
    involvButton: '567d9f25-37ea-4fef-852c-f01c0e308f06',
    involvTabs: 'abd199d4-846c-49dd-9b0e-9fa8d9088b47',
    involvScriptEditor: '24e13daf-8295-4611-8d9b-976d3648af0b',
};
/** Layout-only or invisible web parts: nothing to say about them. */
const SILENT_IDS = new Set([WP.spacer, WP.divider, WP.banner, WP.involvTabs, WP.involvScriptEditor]);
const SILENT_TITLES = /^(Opvulling|Spacer|Scheidingslijn|Divider|Banner|Involv Page Properties|Involv Script Editor|Involv Left Navigation|Enterprise Analytics Center)$/i;
function absolute(url, origin) {
    if (!url)
        return url;
    if (/^(https?:|mailto:|tel:|#)/i.test(url))
        return url;
    if (url.startsWith('//'))
        return `https:${url}`;
    if (url.startsWith('/'))
        return origin + url;
    return url;
}
function makeTurndown(ctx, images) {
    const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '_' });
    td.use(gfmPlugin.gfm);
    td.addRule('absoluteLinks', {
        filter: (node) => node.nodeName === 'A' && Boolean(node.getAttribute('href')),
        replacement: (content, node) => {
            const href = absolute(node.getAttribute('href'), ctx.origin);
            const text = content.trim();
            if (!text)
                return '';
            return text === href ? `<${href}>` : `[${text}](${href})`;
        },
    });
    td.addRule('images', {
        filter: 'img',
        replacement: (_content, node) => {
            const el = node;
            const src = absolute(el.getAttribute('src') ?? '', ctx.origin);
            if (!src)
                return '';
            images.push(src);
            const alt = (el.getAttribute('alt') ?? '').replace(/[[\]]/g, '');
            return `![${alt}](${ctx.image?.(src) ?? src})`;
        },
    });
    return td;
}
/** SharePoint tables have no <th>: promote the first row, so the GFM plugin writes a Markdown table. */
function prepareHtml(html) {
    const root = parse(html);
    for (const table of root.querySelectorAll('table')) {
        if (table.querySelector('th'))
            continue;
        const first = table.querySelector('tr');
        if (!first)
            continue;
        const cells = first.querySelectorAll('td');
        for (const td of cells)
            td.tagName = 'th';
        const thead = parse('<thead></thead>').firstChild;
        thead.appendChild(first.clone());
        first.remove();
        table.childNodes.unshift(thead);
        thead.parentNode = table;
    }
    return root.toString();
}
function htmlToMarkdown(html, td) {
    return td
        .turndown(prepareHtml(html))
        .replace(/[\u00ad\u200b-\u200d\ufeff]/g, '')
        .replace(/\u00a0/g, ' ')
        // "-   item" → "- item"; paragraphs typed as "- text" are lists, not escaped dashes
        .replace(/^(\s*)([-*]|\d+\.) {2,}/gm, '$1$2 ')
        .replace(/^\\- +/gm, '- ')
        // <br> becomes a two-space hard break; before a blank line or a <br>-only line it is noise
        .replace(/^[ \t]+$/gm, '')
        .replace(/[ \t]+\n(?=\n|$)/g, '\n')
        .replace(/[ \t]+$/, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
function str(v) {
    return typeof v === 'string' ? v.trim() : '';
}
function link(text, url) {
    if (!url)
        return text;
    return text && text !== url ? `[${text}](${url})` : `<${url}>`;
}
const IMAGE_KEY = /image|img|thumbnail|picture|photo|icon|filepicker|logo/i;
/**
 * Web parts without a dedicated renderer: their serverProcessedContent holds the visible text
 * (searchablePlainTexts), rich text (htmlStrings) and links, keyed like `items[0].title`.
 */
function renderGenericWebPart(w, ctx, td) {
    const sp = w.serverProcessedContent ?? {};
    const out = [];
    for (const html of Object.values(sp.htmlStrings ?? {})) {
        const md = htmlToMarkdown(html, td);
        if (md)
            out.push(md);
    }
    const groups = new Map();
    const top = { texts: [], links: [] };
    const groupOf = (key) => {
        const m = /^(.*\[\d+\])\.(.+)$/.exec(key);
        if (!m)
            return [top, key];
        if (!groups.has(m[1]))
            groups.set(m[1], { texts: [], links: [] });
        return [groups.get(m[1]), m[2]];
    };
    const htmlKeys = new Set(Object.keys(sp.htmlStrings ?? {}).map((k) => k.replace(/HTML$/, '')));
    for (const [key, value] of Object.entries(sp.searchablePlainTexts ?? {})) {
        if (!str(value) || htmlKeys.has(key))
            continue;
        const [g, field] = groupOf(key);
        g.texts.push([field, value.trim()]);
    }
    for (const [key, value] of Object.entries(sp.links ?? {})) {
        if (!str(value) || key === 'baseUrl' || /wopi|thumbnail|preview|image/i.test(key))
            continue;
        const [g, field] = groupOf(key);
        g.links.push([field, absolute(value.trim(), ctx.origin)]);
    }
    const titleOf = (g) => g.texts.find(([f]) => /^(title|name|displayName|label|text)$/i.test(f))?.[1];
    const topTitle = titleOf(top);
    // A single top-level link (e.g. the file of a "File and media" part) goes on the title.
    const titleLink = topTitle && top.links.length === 1 ? top.links[0][1] : '';
    if (topTitle)
        out.push(`**${link(topTitle, titleLink)}**`);
    for (const [, v] of top.texts)
        if (v !== topTitle)
            out.push(v);
    if (!titleLink)
        for (const [, url] of top.links)
            out.push(`<${url}>`);
    const items = [];
    for (const g of groups.values()) {
        const title = titleOf(g);
        const url = g.links.find(([f]) => /url|href|link/i.test(f))?.[1] ?? g.links[0]?.[1] ?? '';
        const rest = g.texts.filter(([, v]) => v !== title).map(([f, v]) => (/email/i.test(f) ? `<${v}>` : v));
        const head = title ? link(title, url) : url ? `<${url}>` : '';
        const line = [head, ...rest].filter(Boolean).join(' — ');
        if (line)
            items.push(`- ${line}`);
    }
    if (items.length)
        out.push(items.join('\n'));
    // Parts fed by a search query or a list (news, events, FAQ, apps, navigation) show nothing stored.
    const dynamic = Object.keys(w.properties ?? {}).some((k) => /^(queryTemplate|listName|appsListName|configurationListName|newsletterTemplateUrl)$/.test(k));
    if (out.length === 0 && !dynamic) {
        // Fall back to plain string properties that read like content, paired with their links.
        const props = w.properties ?? {};
        const texts = Object.entries(props).filter(([k, v]) => typeof v === 'string' && v.trim() && /title|text|description|heading|content|caption/i.test(k) && !/^description$/i.test(k) && !IMAGE_KEY.test(k));
        const links = Object.entries(props).filter(([k, v]) => typeof v === 'string' && /^https?:\/\//.test(v) && /link|url|href/i.test(k) && !IMAGE_KEY.test(k));
        for (const [, v] of texts)
            out.push(String(v).trim());
        for (const [, v] of links)
            out.push(`<${String(v)}>`);
    }
    return out;
}
function renderCallToAction(p) {
    const out = [];
    const title = str(p.bannerTitle);
    if (title)
        out.push(`**${title}**`);
    if (str(p.bannerDescription))
        out.push(str(p.bannerDescription));
    const buttons = [];
    for (const n of ['', '2', '3', '4', '5', '6']) {
        const text = str(p[`bannerBtnText${n}`]);
        const url = str(p[`bannerLink${n}`]);
        if (text || url)
            buttons.push(`- ${link(text, url)}`);
    }
    if (buttons.length)
        out.push(buttons.join('\n'));
    return out;
}
function renderImage(w, ctx, images) {
    const p = w.properties ?? {};
    const src = str(w.serverProcessedContent?.imageSources?.imageSource);
    if (!src)
        return [];
    const abs = absolute(src, ctx.origin);
    images.push(abs);
    const alt = (str(p.altText) || str(p.captionText) || str(p.overlayText) || str(p.fileName)).replace(/[[\]]/g, '');
    const img = `![${alt}](${ctx.image?.(abs) ?? abs})`;
    const out = [str(p.linkUrl) ? `[${img}](${absolute(str(p.linkUrl), ctx.origin)})` : img];
    if (str(p.captionText))
        out.push(`_${str(p.captionText)}_`);
    return out;
}
function renderEmbed(p) {
    const code = str(p.embedCode) || str(p.cachedEmbedCode);
    const src = /src=["']([^"']+)["']/i.exec(code)?.[1] ?? (/^https?:\/\//.test(code) ? code : '');
    return src ? [`Embedded: <${src}>`] : [];
}
function renderWebPart(w, ctx, td, images) {
    const id = w.id ?? '';
    const title = w.title ?? 'web part';
    if (SILENT_IDS.has(id) || SILENT_TITLES.test(title))
        return [];
    const p = w.properties ?? {};
    let out;
    if (id === WP.involvCallToAction)
        out = renderCallToAction(p);
    else if (id === WP.image)
        out = renderImage(w, ctx, images);
    else if (id === WP.embed)
        out = renderEmbed(p);
    else if (id === WP.involvButton) {
        if (p.enableBackBtn)
            return [];
        out = renderGenericWebPart(w, ctx, td);
    }
    else
        out = renderGenericWebPart(w, ctx, td);
    // A web part that fills itself at view time (news, events, FAQ, people search…) has no stored content.
    return out.length ? out : [`_[${title}: dynamic content, not exported]_`];
}
function decodeAttr(value) {
    return value
        .replace(/&#123;/g, '{')
        .replace(/&#125;/g, '}')
        .replace(/&#58;/g, ':')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}
function parseJsonAttr(el, name) {
    const raw = el.getAttribute(name);
    if (!raw)
        return undefined;
    for (const candidate of [raw, decodeAttr(raw)]) {
        try {
            return JSON.parse(candidate);
        }
        catch {
            // try the decoded form
        }
    }
    return undefined;
}
/**
 * Converts a modern page's CanvasContent1 (text controls holding HTML, web parts holding JSON in
 * data-sp-webpartdata) to Markdown, in page order. Also accepts plain HTML (classic WikiField).
 */
export function canvasToMarkdown(canvasHtml, ctx) {
    const images = [];
    const td = makeTurndown(ctx, images);
    const root = parse(canvasHtml, { lowerCaseTagName: false, comment: false });
    const controls = root.querySelectorAll('[data-sp-controldata]');
    if (controls.length === 0) {
        return { markdown: htmlToMarkdown(canvasHtml, td), images };
    }
    const blocks = [];
    for (const control of controls) {
        const data = parseJsonAttr(control, 'data-sp-controldata');
        const wpEl = control.querySelector('[data-sp-webpartdata]');
        if (wpEl) {
            const w = parseJsonAttr(wpEl, 'data-sp-webpartdata');
            if (w)
                blocks.push(...renderWebPart(w, ctx, td, images));
            continue;
        }
        if (data?.controlType === 4 || control.querySelector('[data-sp-rte]')) {
            const md = htmlToMarkdown(control.innerHTML, td);
            if (md)
                blocks.push(md);
        }
    }
    return { markdown: blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(), images };
}
// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------
function slugify(text) {
    return (text
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\.aspx$/, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'page');
}
function imageFileName(url, index) {
    let base = 'image';
    try {
        const u = new URL(url);
        const pathParam = u.searchParams.get('path');
        base = decodeURIComponent((pathParam ?? u.pathname).split('/').filter(Boolean).at(-1) ?? 'image');
    }
    catch {
        // keep default
    }
    return `${String(index + 1).padStart(2, '0')}-${base.replace(/[^\w.-]+/g, '_').slice(0, 80)}`;
}
export function renderSharePointPage(url, link, item, image) {
    const title = (item.Title ?? link.fileName.replace(/\.aspx$/i, '')).trim();
    const body = canvasToMarkdown(item.CanvasContent1 || item.WikiField || '', { origin: link.origin, image });
    const meta = [];
    const by = item.FieldValuesAsText?.Author;
    if (item.FirstPublishedDate)
        meta.push(`Published ${item.FirstPublishedDate.slice(0, 10)}${by ? ` by ${by}` : ''}`);
    if (item.Modified)
        meta.push(`Modified ${item.Modified.slice(0, 10)}${item.FieldValuesAsText?.Editor ? ` by ${item.FieldValuesAsText.Editor}` : ''}`);
    const lines = [`# ${title}`, '', `${meta.join(' · ')}${meta.length ? ' · ' : ''}[Open in SharePoint](${url})`, ''];
    const description = (item.Description ?? '').trim();
    // The description is usually the page's first paragraph; only repeat it when it is not.
    if (description && !body.markdown.replace(/\s+/g, ' ').includes(description.replace(/\s+/g, ' ').slice(0, 60)))
        lines.push(`> ${description}`, '');
    lines.push(body.markdown || '_(no static content)_', '');
    return { title, markdown: lines.join('\n'), images: body.images };
}
/**
 * Writes `<outputDir>/sharepoint/<site>-<page slug>/page.md` with the page's images next to it.
 * A changed page keeps the previous copy as `.page.previous.md`.
 */
export async function exportSharePointPage(url, opts) {
    const link = parseSharePointPageUrl(url);
    const client = opts.client ?? new SharePointClient(await loadSharePointAuth(url));
    const item = await fetchSharePointPage(client, link);
    const dir = join(opts.outputDir, 'sharepoint', `${slugify(link.site)}-${slugify(link.fileName)}`);
    mkdirSync(dir, { recursive: true });
    // First pass collects the image URLs; download the ones on the tenant, then render with local paths.
    const local = new Map();
    const imageErrors = [];
    const first = renderSharePointPage(url, link, item);
    if (opts.images !== false) {
        const unique = [...new Set(first.images)].filter((src) => src.toLowerCase().startsWith(link.origin) || /\.odsp\.cdn\.office\.net\//.test(src));
        for (const [i, src] of unique.entries()) {
            const name = imageFileName(src, i);
            try {
                writeFileSync(join(dir, name), await client.download(src));
                local.set(src, `./${name}`);
            }
            catch (err) {
                imageErrors.push(err.message);
            }
        }
    }
    const page = local.size ? renderSharePointPage(url, link, item, (src) => local.get(src)) : first;
    const frontmatter = [
        '---',
        'sharepoint:',
        `  title: ${JSON.stringify(page.title)}`,
        `  site: ${JSON.stringify(link.site)}`,
        ...(item.Id !== undefined ? [`  id: ${item.Id}`] : []),
        ...(item.Modified ? [`  updatedAt: ${JSON.stringify(item.Modified)}`] : []),
        ...(item.FirstPublishedDate ? [`  publishedAt: ${JSON.stringify(item.FirstPublishedDate)}`] : []),
        ...(item.PromotedState === 2 ? ['  news: true'] : []),
        `  url: ${JSON.stringify(url)}`,
        '---',
        '',
    ].join('\n');
    const path = join(dir, 'page.md');
    const content = frontmatter + page.markdown;
    let changed = true;
    if (existsSync(path)) {
        const old = readFileSync(path, 'utf8');
        changed = old !== content;
        if (changed)
            copyFileSync(path, join(dir, '.page.previous.md'));
    }
    writeFileSync(path, content);
    return { dir, path, title: page.title, changed, imageCount: local.size, imageErrors };
}
/** The KQL sent to SharePoint: pages only unless `documents`, optionally inside one site. */
export function sharePointQuery(query, opts = {}) {
    const parts = [query.trim()];
    if (!opts.documents)
        parts.push('contentclass:STS_ListItem_WebPageLibrary');
    if (opts.site)
        parts.push(`path:"${opts.site.replace(/\/SitePages\/.*$/i, '').replace(/\/$/, '')}"`);
    return parts.filter(Boolean).join(' ');
}
/** Hit highlighting stripped; SharePoint repeats fragments, so each one is kept once. */
export function cleanSummary(text, width = 200) {
    const fragments = (text ?? '')
        .replace(/<\/?c\d>/g, '')
        .replace(/[\u00ad\u200b-\u200d\ufeff]/g, '')
        .replace(/<[^>]+\/?>(?<!<ddd\/>)/g, '')
        .split(/<ddd\/>|…/)
        .map((f) => f.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    const kept = [];
    for (const f of fragments) {
        if (kept.some((k) => k.includes(f)))
            continue;
        const shorter = kept.findIndex((k) => f.includes(k));
        if (shorter >= 0)
            kept[shorter] = f;
        else
            kept.push(f);
    }
    const joined = kept.join(' … ');
    return joined.length > width ? `${joined.slice(0, width - 1).trimEnd()}…` : joined;
}
export async function searchSharePoint(client, query, opts = {}) {
    const kql = sharePointQuery(query, opts);
    const select = 'Title,Path,LastModifiedTime,SiteTitle,HitHighlightedSummary,FileExtension';
    const url = `${client.origin}/_api/search/query?querytext=${odataString(kql)}&selectproperties='${select}'&rowlimit=${opts.max ?? 20}&trimduplicates=true`;
    const res = await client.json(url);
    const table = res.PrimaryQueryResult?.RelevantResults;
    const hits = (table?.Table?.Rows ?? []).map((row) => {
        const c = Object.fromEntries(row.Cells.map((cell) => [cell.Key, cell.Value ?? '']));
        return {
            modified: (c.LastModifiedTime ?? '').slice(0, 10),
            site: c.SiteTitle ?? '',
            title: (c.Title ?? '').trim(),
            url: c.Path ?? '',
            summary: cleanSummary(c.HitHighlightedSummary),
            type: (c.FileExtension ?? '').toLowerCase(),
        };
    });
    return { kql, total: table?.TotalRows ?? hits.length, hits };
}
//# sourceMappingURL=sharepoint.js.map