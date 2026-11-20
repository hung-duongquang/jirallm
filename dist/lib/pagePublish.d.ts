import type { ResolvedProfile } from './config.js';
/**
 * Publishes any markdown file as a Confluence page (feature context for testers, a design note, …).
 * The page id is kept in a sidecar next to the file, so later runs update the same page.
 */
export type PublishedRef = {
    site: string;
    pageId: string;
};
export type PagePublishPlan = {
    action: 'create' | 'update';
    site: string;
    title: string;
    space?: string;
    parentId?: string;
    pageId?: string;
    attachments: string[];
    link?: string;
};
export type PagePublishResult = PagePublishPlan & {
    url: string;
    version: number;
    pageId: string;
};
export declare const sidecarPath: (file: string) => string;
/** Page title: the first `# ` heading, else the file name. Also returns the body without frontmatter and that heading. */
export declare function splitTitle(md: string, file: string): {
    title: string;
    body: string;
};
/**
 * Local images and files linked from the markdown become page attachments: their links are rewritten
 * to `attachments/<name>`, which the wiki conversion turns into `!name!` / `[^name]`.
 */
export declare function localAttachments(body: string, baseDir: string, exists?: (p: string) => boolean): {
    body: string;
    files: Map<string, string>;
};
/** A page id, or a page URL (whose site must be an allowed one). */
export declare function pageRef(value: string, profile: ResolvedProfile): {
    id: string;
    site?: string;
};
export declare function defaultSite(profile: ResolvedProfile): string;
export declare function pagePublish(profile: ResolvedProfile, file: string, opts: {
    space?: string;
    parent?: string;
    page?: string;
    title?: string;
    site?: string;
    link?: string;
    dryRun?: boolean;
}): Promise<PagePublishPlan | PagePublishResult>;
//# sourceMappingURL=pagePublish.d.ts.map