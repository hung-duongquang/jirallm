/**
 * Page id of a short link (`/wiki/x/<id>`): the id's little-endian bytes in base64, with
 * `-`/`_` for `/`/`+` and the trailing `A`s (zero bytes) dropped.
 */
export function tinyLinkToPageId(tiny) {
    if (!/^[A-Za-z0-9_-]+$/.test(tiny))
        return undefined;
    const base64 = tiny.replace(/-/g, '/').replace(/_/g, '+');
    const padded = base64.padEnd(Math.ceil(Math.max(base64.length, 8) / 4) * 4, 'A');
    const bytes = Buffer.from(padded, 'base64');
    let id = 0n;
    for (let i = bytes.length - 1; i >= 0; i--)
        id = (id << 8n) | BigInt(bytes[i]);
    return id > 0n ? id.toString() : undefined;
}
/**
 * Recognises Confluence Cloud page and whiteboard URLs: `/wiki/spaces/<space>/pages/<id>/…`,
 * `/wiki/pages/viewpage.action?pageId=<id>`, short links `/wiki/x/<tiny>` and
 * `/wiki/spaces/<space>/whiteboard/<id>`.
 */
export function parseConfluenceUrl(url) {
    let parsed;
    try {
        parsed = new URL(url.trim());
    }
    catch {
        return undefined;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
        return undefined;
    const origin = parsed.origin.toLowerCase();
    const path = parsed.pathname;
    let m = /^\/wiki\/spaces\/[^/]+\/pages\/(?:edit-v2\/)?(\d+)(?:\/|$)/.exec(path);
    if (m)
        return { origin, kind: 'page', id: m[1] };
    m = /^\/wiki\/spaces\/[^/]+\/whiteboard\/(\d+)(?:\/|$)/.exec(path);
    if (m)
        return { origin, kind: 'whiteboard', id: m[1] };
    m = /^\/wiki\/x\/([A-Za-z0-9_-]+)\/?$/.exec(path);
    if (m) {
        const id = tinyLinkToPageId(m[1]);
        return id ? { origin, kind: 'page', id } : undefined;
    }
    if (/^\/wiki\/pages\/viewpage\.action$/.test(path)) {
        const id = parsed.searchParams.get('pageId');
        if (id && /^\d+$/.test(id))
            return { origin, kind: 'page', id };
    }
    return undefined;
}
export const confluenceRefKey = (ref) => `${ref.origin}|${ref.kind}|${ref.id}`;
// A Markdown link, or a bare URL (the link alternative wins where both could match).
const LINK_OR_URL = /\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()[\]`]+)/g;
// Sentence punctuation directly after a bare URL is not part of it.
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;
/**
 * Confluence items referenced in Markdown (links and bare URLs), first occurrence first,
 * each with the URL it was first linked by.
 */
export function collectConfluenceRefs(markdown) {
    const refs = new Map();
    for (const m of markdown.matchAll(LINK_OR_URL)) {
        const url = m[2] ?? m[3].replace(TRAILING_PUNCTUATION, '');
        const ref = parseConfluenceUrl(url);
        if (ref && !refs.has(confluenceRefKey(ref)))
            refs.set(confluenceRefKey(ref), { ...ref, url });
    }
    return [...refs.values()];
}
const escapeLinkText = (text) => text.replace(/([[\]])/g, '\\$1');
// Link texts that only stand in for the target and are better replaced by its title.
const PLACEHOLDER_TEXTS = new Set(['whiteboard', 'embedded content']);
/**
 * Rewrites links and bare URLs to Confluence items that `resolve` knows: the target becomes
 * the local copy when there is one, and a link without real text (the URL itself) shows the
 * item's title. Unknown items are left alone.
 */
export function rewriteConfluenceLinks(markdown, resolve) {
    return markdown.replace(LINK_OR_URL, (match, text, linkUrl, bare) => {
        const url = linkUrl ?? bare.replace(TRAILING_PUNCTUATION, '');
        const trailing = linkUrl ? '' : bare.slice(url.length);
        const ref = parseConfluenceUrl(url);
        const resolved = ref && resolve(ref);
        if (!ref || !resolved)
            return match;
        const label = ref.kind === 'whiteboard' ? `Whiteboard: ${resolved.title}` : resolved.title;
        const keepText = text !== undefined && text.trim() !== '' && text.trim() !== url &&
            !PLACEHOLDER_TEXTS.has(text.trim().toLowerCase());
        const shown = keepText ? text : escapeLinkText(label);
        return `[${shown}](${resolved.path ?? url})${trailing}`;
    });
}
//# sourceMappingURL=confluenceLinks.js.map