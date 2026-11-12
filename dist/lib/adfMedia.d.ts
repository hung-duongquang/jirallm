import { type ImageSize } from './imageSize.js';
export type AdfMark = {
    type: string;
    attrs?: Record<string, unknown>;
};
export type AdfNode = {
    type: string;
    attrs?: Record<string, unknown>;
    content?: AdfNode[];
    marks?: AdfMark[];
    text?: string;
};
export type AdfDocument = {
    version: number;
    type: string;
    content: AdfNode[];
};
export declare const IMAGE_EXTENSIONS: Set<string>;
export declare const IMAGE_LAYOUTS: readonly ["center", "align-start", "align-end", "wrap-left", "wrap-right", "wide", "full-width"];
export type ImageLayout = (typeof IMAGE_LAYOUTS)[number];
export declare const DEFAULT_IMAGE_LAYOUT: ImageLayout;
export declare const DEFAULT_IMAGE_WIDTH = 50;
export declare const MEDIA_KINDS: readonly ["image", "video", "file"];
export type MediaKind = (typeof MEDIA_KINDS)[number];
export type MediaSpec = {
    path: string;
    caption?: string;
};
export type EmbeddedMedia = {
    marker: string;
    filename: string;
    source: string;
    kind: MediaKind;
    caption?: string;
    size?: ImageSize;
};
export type MediaLayoutOptions = {
    layout: ImageLayout;
    width: number;
};
export declare function isImageFile(filename: string): boolean;
export declare function mediaKind(filename: string): MediaKind;
/** Images and videos get sized inline; everything else renders as a compact tile. */
export declare function isSizedMedia(kind: MediaKind): boolean;
export declare function parseImageLayout(value?: string): ImageLayout;
export declare function parseImageWidth(value?: string): number;
export declare function parseMediaSpec(spec: string): MediaSpec;
export declare function mediaMarker(index: number): string;
export declare function describeMedia(filePath: string, caption: string | undefined, index: number): Promise<EmbeddedMedia>;
export declare function buildMediaEmbedBlock(media: EmbeddedMedia[]): string;
export type PlacementResult = {
    body: string;
    placed: EmbeddedMedia[];
    warnings: string[];
};
/** Replaces `@@media:<name>@@` placeholder lines with the embed block for that file. */
export declare function placeMediaMarkers(body: string, media: EmbeddedMedia[]): PlacementResult;
export type RewriteResult = {
    doc: AdfDocument;
    warnings: string[];
    replaced: number;
};
export declare function rewriteAdfMedia(doc: AdfDocument, media: EmbeddedMedia[], options: MediaLayoutOptions): RewriteResult;
export declare function containsMarkers(text: string, media: EmbeddedMedia[]): boolean;
export declare function isAdfDocument(value: unknown): value is AdfDocument;
export declare function applyMediaSingle(io: {
    get: () => Promise<unknown>;
    put: (doc: AdfDocument) => Promise<void>;
}, media: EmbeddedMedia[], options: MediaLayoutOptions): Promise<string[]>;
//# sourceMappingURL=adfMedia.d.ts.map