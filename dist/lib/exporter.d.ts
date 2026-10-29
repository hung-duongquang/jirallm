import { type JiraConfig } from './jiraClient.js';
import { type ConfluenceRef, type ResolvedConfluenceRef } from './confluenceLinks.js';
import { type CustomFieldDefs, type FieldSelector } from './exportFields.js';
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
    onIssueStart?: (key: string, info: {
        requested: boolean;
        via?: string;
    }) => void;
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
    onIssueFailed?: (key: string, info: {
        requested: boolean;
        via?: string;
        error: string;
    }) => void;
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
    failed: Array<{
        key: string;
        error: string;
    }>;
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
/**
 * Confluence lookups of one export run: every page or whiteboard is fetched once, however
 * many issues link to it, and links resolve against what the run (or an earlier one) wrote.
 */
declare class ConfluenceRun {
    private readonly options;
    private readonly credentials;
    private readonly redirects;
    private readonly items;
    private readonly settled;
    private readonly clients;
    private readonly sites;
    constructor(options: ExportOptions, credentials: {
        userEmail: string;
        apiToken: string;
        jiraOrigin: string;
    }, redirects: JiraConfig['redirects']);
    /** Confluence items in `markdown` on a configured site. */
    refsIn(markdown: string): Array<ConfluenceRef & {
        url: string;
    }>;
    private client;
    fetch(ref: ConfluenceRef, url: string, via: string, batchKeys: string[]): Promise<ConfluenceItem>;
    private load;
    /**
     * How a link to `ref` is written from a file `pathToConfluenceDir` away from the
     * confluence folder: local page copies (this run's or earlier ones) and titled whiteboards.
     */
    resolve(ref: ConfluenceRef, pathToConfluenceDir: string): ResolvedConfluenceRef | undefined;
    all(): ConfluenceItemInfo[];
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
export declare class JiraExporter {
    private client;
    private baseUrl;
    private config;
    private apiToken;
    constructor(config: JiraConfig, apiToken: string);
    private confluenceRun;
    exportIssue(issueKey: string, options: ExportOptions, context?: {
        expandLinks?: boolean;
        confluence?: ConfluenceRun;
    }): Promise<ExportIssueOutcome>;
    exportIssues(issueKeys: string[], options: ExportOptions): Promise<ExportResult>;
}
export {};
//# sourceMappingURL=exporter.d.ts.map