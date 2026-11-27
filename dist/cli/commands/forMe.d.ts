import type { ResolvedProfile } from '../../lib/config.js';
import { type JqlIssue } from '../../lib/jiraClient.js';
export type ForMeItem = {
    /** Stable id, so a watch round tells each once. */
    id: string;
    kind: 'jira-mention' | 'confluence-mention' | 'github' | 'assigned';
    /** Jira key when there is one. */
    key?: string;
    from: string;
    title: string;
    text: string;
    url: string;
    at: number;
};
/** Plain text of an ADF document (mentions as @name) or of a wiki-markup string. */
export declare function adfText(node: unknown): string;
/** Comments created since that mention `me` (an ADF mention node or wiki [~accountid:…]), not by `me`. */
export declare function mentionsIn(issues: JqlIssue[], me: string, since: number, base: string): ForMeItem[];
/** Jira: comments mentioning the user, and tickets assigned to them, since. */
export declare function jiraForMe(profile: ResolvedProfile, since: number): Promise<ForMeItem[]>;
/** Confluence pages, blog posts and comments that mention the user, modified since. */
export declare function confluenceForMe(profile: ResolvedProfile, since: number): Promise<ForMeItem[]>;
/** API url of an issue or PR → its web page. */
export declare function webUrl(api: string | null | undefined, repo: string): string;
/** GitHub notifications since for a mention or an assignment (review requests are listed elsewhere). */
export declare function githubForMe(since: number): Promise<ForMeItem[]>;
/** One line for the change log / the catch-up brief. */
export declare function forMeLine(i: ForMeItem): string;
export declare const FOR_ME_STATE = ".watch.for-me.json";
/**
 * One watch round: what is new for the user since the last round (the first round only starts the
 * clock, so the backlog stays quiet). Items a running session started itself (a ticket it assigned to
 * the user with `jirallm start`) are left out by the caller.
 */
export declare function forMeRound(outputDir: string, profile: ResolvedProfile, opts?: {
    now?: number;
    sources?: Array<(since: number) => Promise<ForMeItem[]>>;
}): Promise<{
    items: ForMeItem[];
    errors: string[];
}>;
export declare const TICKET_KEY: RegExp;
export declare function ticketPrompt(key: string): string;
/** `jirallm ticket:handle <KEY>`: a new Claude session on a ticket just assigned to the user, in the workspace. */
export declare function runTicketHandle(key: string, opts?: {
    outputDir?: string;
}): Promise<void>;
//# sourceMappingURL=forMe.d.ts.map