import type { JiraClient } from '../lib/jiraClient.js';
import { type EmbeddedMedia, type MediaLayoutOptions } from '../lib/adfMedia.js';
export type AttachOptions = {
    attach?: string[];
    attachImages?: string[];
    attachMedia?: string[];
    imageLayout?: string;
    imageWidth?: string;
};
export type PreparedAttachments = {
    body: string;
    attachedNames: string[];
    media: EmbeddedMedia[];
    layout: MediaLayoutOptions;
};
export declare function previewMedia(media: EmbeddedMedia[], layout: MediaLayoutOptions): {
    filename: string;
    kind: "image" | "video" | "file";
    caption: string | undefined;
    layout: "center" | "align-start" | "align-end" | "wrap-left" | "wrap-right" | "wide" | "full-width";
    width: number;
    pixels: import("../lib/imageSize.js").ImageSize | undefined;
}[];
export declare function reportWarnings(warnings: string[]): void;
export declare function embedCommentImages(client: JiraClient, issueKey: string, commentId: string, media: EmbeddedMedia[], layout: MediaLayoutOptions): Promise<void>;
export declare function embedDescriptionImages(client: JiraClient, issueKey: string, media: EmbeddedMedia[], layout: MediaLayoutOptions): Promise<void>;
export declare function embedForAttachment(filename: string): string;
export declare function resolveMediaLayout(opts: AttachOptions): MediaLayoutOptions;
export declare function prepareAttachments(client: JiraClient, issueKey: string, rawBody: string, opts: AttachOptions, dryRun: boolean): Promise<PreparedAttachments>;
//# sourceMappingURL=attachEmbeds.d.ts.map