/**
 * Turns text copied from a Claude Code terminal (markdown, box-drawing tables, the "● " bullet and
 * two-space indent of a reply) into something that reads well in Slack, which has no tables: each
 * table row becomes a bullet ("*first cell* — other cells"). Produces HTML for the clipboard (Slack
 * keeps bold, lists, links and code when rich text is pasted) and a plain-text fallback.
 */
type Block = {
    kind: 'para';
    lines: string[];
} | {
    kind: 'heading';
    text: string;
} | {
    kind: 'list';
    items: Array<{
        level: number;
        ordered: boolean;
        text: string;
    }>;
} | {
    kind: 'table';
    header?: string[];
    rows: string[][];
} | {
    kind: 'code';
    lines: string[];
};
/** Drops the reply marker and the indent Claude Code puts before every line of a reply. */
export declare function normalizeTerminalText(text: string): string[];
export declare function parseBlocks(text: string): Block[];
/** Inline markdown → HTML: code, bold, italics, links, bare URLs. */
export declare function inlineHtml(text: string): string;
/** Inline markdown → Slack's own markup, for a plain-text paste: *bold*, _italic_, `code`, "text (url)". */
export declare function inlinePlain(text: string): string;
export declare function toSlackHtml(text: string): string;
export declare function toSlackText(text: string): string;
/** The clipboard's CF_HTML format (Windows): a header with UTF-8 byte offsets around the fragment. */
export declare function cfHtml(fragment: string): string;
export {};
//# sourceMappingURL=slackFormat.d.ts.map