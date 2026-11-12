export type SlackCopyOptions = {
    print?: boolean;
};
/** Every non-ASCII character as a numeric HTML entity. */
export declare const asciiHtml: (html: string) => string;
export declare function readClipboard(): string;
/**
 * Puts the text on the clipboard. On Windows as rich text (HTML) too, which Slack keeps when it is
 * pasted (bold, lists, links, code); elsewhere as plain text in Slack's own markup.
 */
export declare function writeClipboard(text: string, html: string): 'rich' | 'plain';
/** `jirallm slack:copy [file]`: from a file, piped stdin, or else the clipboard, back to the clipboard Slack-ready. */
export declare function runSlackCopy(file: string | undefined, opts: SlackCopyOptions): Promise<void>;
//# sourceMappingURL=slackCopy.d.ts.map