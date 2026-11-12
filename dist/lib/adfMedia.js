import { isVideoFile } from 'framewise';
import { readImageSize } from './imageSize.js';
import { readVideoSize } from './videoSize.js';
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
export const IMAGE_LAYOUTS = [
    'center',
    'align-start',
    'align-end',
    'wrap-left',
    'wrap-right',
    'wide',
    'full-width',
];
export const DEFAULT_IMAGE_LAYOUT = 'align-start';
export const DEFAULT_IMAGE_WIDTH = 50;
export const MEDIA_KINDS = ['image', 'video', 'file'];
export function isImageFile(filename) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    return IMAGE_EXTENSIONS.has(ext);
}
export function mediaKind(filename) {
    if (isImageFile(filename))
        return 'image';
    if (isVideoFile(filename))
        return 'video';
    return 'file';
}
/** Images and videos get sized inline; everything else renders as a compact tile. */
export function isSizedMedia(kind) {
    return kind !== 'file';
}
export function parseImageLayout(value) {
    if (value === undefined)
        return DEFAULT_IMAGE_LAYOUT;
    const match = IMAGE_LAYOUTS.find((l) => l === value);
    if (!match) {
        throw new Error(`Invalid --image-layout "${value}". Allowed values: ${IMAGE_LAYOUTS.join(', ')}.`);
    }
    return match;
}
export function parseImageWidth(value) {
    if (value === undefined)
        return DEFAULT_IMAGE_WIDTH;
    const width = Number(value);
    if (!Number.isInteger(width) || width < 1 || width > 100) {
        throw new Error(`Invalid --image-width "${value}". Expected an integer between 1 and 100.`);
    }
    return width;
}
export function parseMediaSpec(spec) {
    const match = /^(.*?):"([\s\S]*)"$/.exec(spec);
    if (!match)
        return { path: spec };
    const [, path, caption] = match;
    if (!path)
        return { path: spec };
    return caption ? { path, caption } : { path };
}
export function mediaMarker(index) {
    return `⟦jirallm-media-${index}⟧`;
}
function basename(filePath) {
    return filePath.split(/[\\/]/).pop() ?? filePath;
}
async function readMediaSize(filePath, kind) {
    if (kind === 'image')
        return readImageSize(filePath);
    if (kind === 'video')
        return readVideoSize(filePath);
    return undefined;
}
export async function describeMedia(filePath, caption, index) {
    const kind = mediaKind(filePath);
    const size = await readMediaSize(filePath, kind);
    return { marker: mediaMarker(index), filename: basename(filePath), source: filePath, kind, caption, size };
}
export function buildMediaEmbedBlock(media) {
    return media.map((item) => `${item.marker}\n\n[^${item.filename}]`).join('\n\n');
}
/**
 * Positional placeholder the author writes in the body, e.g. `@@media:demo.webm@@`.
 * Deliberately punctuation that survives both markdown→wiki conversion and `--no-wiki`.
 */
const PLACEHOLDER_PATTERN = /^[^\S\n]*@@media:([^@\n]+)@@[^\S\n]*$/gm;
function matchesPlaceholder(item, name) {
    const wanted = name.trim().toLowerCase();
    return (item.filename.toLowerCase() === wanted ||
        item.source.toLowerCase() === wanted ||
        basename(item.source).toLowerCase() === wanted);
}
/** Replaces `@@media:<name>@@` placeholder lines with the embed block for that file. */
export function placeMediaMarkers(body, media) {
    const placed = [];
    const warnings = [];
    const available = [...media];
    const replaced = body.replace(PLACEHOLDER_PATTERN, (match, name) => {
        const index = available.findIndex((item) => matchesPlaceholder(item, name));
        if (index === -1) {
            warnings.push(`No attached file matches placeholder "@@media:${name.trim()}@@" — left as text.`);
            return match;
        }
        const [item] = available.splice(index, 1);
        placed.push(item);
        return buildMediaEmbedBlock([item]);
    });
    return { body: replaced, placed, warnings };
}
function paragraphText(node) {
    if (node.type !== 'paragraph')
        return '';
    return (node.content ?? []).map((child) => child.text ?? '').join('').trim();
}
function mediaChildren(node) {
    if (node.type !== 'mediaGroup' && node.type !== 'mediaSingle')
        return [];
    return (node.content ?? []).filter((child) => child.type === 'media');
}
function buildMediaNode(media, item) {
    const attrs = {
        type: media.attrs?.type ?? 'file',
        id: media.attrs?.id,
        collection: media.attrs?.collection ?? '',
    };
    const width = item.size?.width ?? media.attrs?.width;
    const height = item.size?.height ?? media.attrs?.height;
    if (width !== undefined && height !== undefined) {
        attrs.width = width;
        attrs.height = height;
    }
    return { type: 'media', attrs };
}
function buildMediaSingle(media, item, options) {
    return {
        type: 'mediaSingle',
        attrs: { layout: options.layout, width: options.width },
        content: [buildMediaNode(media, item)],
    };
}
function buildCaptionParagraph(caption) {
    return {
        type: 'paragraph',
        content: [{ type: 'text', text: caption, marks: [{ type: 'em' }] }],
    };
}
export function rewriteAdfMedia(doc, media, options) {
    const byMarker = new Map(media.map((item) => [item.marker, item]));
    const seen = new Set();
    const warnings = [];
    const content = [];
    let replaced = 0;
    let openTile;
    const nodes = doc.content ?? [];
    for (let i = 0; i < nodes.length; i++) {
        const item = byMarker.get(paragraphText(nodes[i]));
        if (!item) {
            openTile = undefined;
            content.push(nodes[i]);
            continue;
        }
        seen.add(item.marker);
        const next = nodes[i + 1];
        const found = next ? mediaChildren(next) : [];
        if (found.length === 0) {
            openTile = undefined;
            warnings.push(`No media node found for "${item.filename}" — left unchanged.`);
            continue;
        }
        const node = buildMediaNode(found[0], item);
        if (isSizedMedia(item.kind)) {
            openTile = undefined;
            content.push(buildMediaSingle(found[0], item, options));
        }
        else if (openTile) {
            openTile.content = [...(openTile.content ?? []), node];
        }
        else {
            openTile = { type: 'mediaGroup', content: [node] };
            content.push(openTile);
        }
        if (item.caption) {
            openTile = undefined;
            content.push(buildCaptionParagraph(item.caption));
        }
        const rest = found.slice(1);
        if (rest.length > 0) {
            openTile = undefined;
            content.push({ ...next, content: rest });
        }
        replaced++;
        i++;
    }
    for (const item of media) {
        if (!seen.has(item.marker)) {
            warnings.push(`Marker for "${item.filename}" not found in the published content.`);
        }
    }
    return { doc: { ...doc, content }, warnings, replaced };
}
export function containsMarkers(text, media) {
    return media.some((item) => text.includes(item.marker));
}
export function isAdfDocument(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value.type === 'doc' &&
        Array.isArray(value.content));
}
export async function applyMediaSingle(io, media, options) {
    if (media.length === 0)
        return [];
    const body = await io.get();
    if (!isAdfDocument(body)) {
        return ['Jira did not return an ADF document — media left as attachment cards.'];
    }
    const { doc, warnings, replaced } = rewriteAdfMedia(body, media, options);
    if (replaced > 0)
        await io.put(doc);
    return warnings;
}
//# sourceMappingURL=adfMedia.js.map