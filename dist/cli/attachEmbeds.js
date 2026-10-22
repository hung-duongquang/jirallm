import { basename } from 'path';
import { applyMediaSingle, buildMediaEmbedBlock, describeMedia, isImageFile, mediaMarker, parseImageLayout, parseMediaSpec, parseImageWidth, placeMediaMarkers, } from '../lib/adfMedia.js';
export function previewMedia(media, layout) {
    return media.map((item) => ({
        filename: item.filename,
        kind: item.kind,
        caption: item.caption,
        layout: layout.layout,
        width: layout.width,
        pixels: item.size,
    }));
}
export function reportWarnings(warnings) {
    for (const warning of warnings)
        console.warn(`Warning: ${warning}`);
}
export async function embedCommentImages(client, issueKey, commentId, media, layout) {
    const warnings = await applyMediaSingle({
        get: async () => (await client.getComment(issueKey, commentId)).body,
        put: (doc) => client.updateCommentAdf(issueKey, commentId, doc),
    }, media, layout);
    reportWarnings(warnings);
}
export async function embedDescriptionImages(client, issueKey, media, layout) {
    const warnings = await applyMediaSingle({
        get: () => client.getIssueDescriptionAdf(issueKey),
        put: (doc) => client.updateIssueDescriptionAdf(issueKey, doc),
    }, media, layout);
    reportWarnings(warnings);
}
export function embedForAttachment(filename) {
    return isImageFile(filename) ? `!${filename}|thumbnail!` : `[^${filename}]`;
}
export function resolveMediaLayout(opts) {
    return { layout: parseImageLayout(opts.imageLayout), width: parseImageWidth(opts.imageWidth) };
}
async function uploadOrPreview(client, issueKey, filePath, dryRun) {
    if (dryRun)
        return basename(filePath);
    const uploaded = await client.uploadAttachment(issueKey, filePath);
    return uploaded[0]?.filename ?? basename(filePath);
}
function appendBlocks(body, blocks) {
    const joined = blocks.filter(Boolean).join('\n\n');
    if (!joined)
        return body;
    return `${body.replace(/\s+$/, '')}\n\n${joined}\n`;
}
export async function prepareAttachments(client, issueKey, rawBody, opts, dryRun) {
    const layout = resolveMediaLayout(opts);
    const specs = [...(opts.attachImages ?? []), ...(opts.attachMedia ?? [])].map(parseMediaSpec);
    const plainFiles = opts.attach ?? [];
    if (plainFiles.length === 0 && specs.length === 0) {
        return { body: rawBody, attachedNames: [], media: [], layout };
    }
    const attachedNames = [];
    const plainNames = [];
    for (const file of plainFiles) {
        const name = await uploadOrPreview(client, issueKey, file, dryRun);
        plainNames.push(name);
        attachedNames.push(name);
    }
    const media = [];
    for (const spec of specs) {
        const name = await uploadOrPreview(client, issueKey, spec.path, dryRun);
        attachedNames.push(name);
        const described = await describeMedia(spec.path, spec.caption, media.length);
        media.push({ ...described, filename: name, marker: mediaMarker(media.length) });
    }
    const placement = placeMediaMarkers(rawBody, media);
    reportWarnings(placement.warnings);
    const placed = new Set(placement.placed.map((item) => item.marker));
    const trailing = media.filter((item) => !placed.has(item.marker));
    return {
        body: appendBlocks(placement.body, [
            plainNames.map(embedForAttachment).join('\n'),
            buildMediaEmbedBlock(trailing),
        ]),
        attachedNames,
        media,
        layout,
    };
}
//# sourceMappingURL=attachEmbeds.js.map