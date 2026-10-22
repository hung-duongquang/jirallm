/** `ZOD-3568` for `https://acme.atlassian.net/browse/ZOD-3568` (query/fragment allowed). */
export declare function jiraIssueKeyFromUrl(url: string): string | undefined;
export type LocalIssueLinkOptions = {
    /** Folder the issue bundles are exported to; task.md files live one level below it. */
    outputDir: string;
    /** The issue being written; links to itself stay pointed at Jira. */
    selfKey?: string;
    /** Issues exported in the same run, which may not be on disk yet. */
    batchKeys?: string[];
    /** Path from the file being written back to `outputDir`. Default: `../` (an issue bundle). */
    pathToOutputDir?: string;
};
/**
 * Points Markdown links to Jira issues (`[text](https://…/browse/KEY)`) at a local copy when
 * the output folder has one: an exported bundle (`<key>/task.md`) or a loose `KEY….md` file.
 * Links are rewritten relative to the issue's own folder (`<outputDir>/<key>/task.md`).
 * Issues without a local copy keep their Jira link.
 */
export declare function linkLocalIssues(markdown: string, options: LocalIssueLinkOptions): string;
//# sourceMappingURL=issueLinks.d.ts.map