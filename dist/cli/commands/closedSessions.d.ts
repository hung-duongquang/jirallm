import { toast } from './prStatus.js';
/** What is worth interrupting for: someone reviewed, CI failed, it merged, a new comment, reply or message. */
export declare const IMPORTANT: RegExp;
/** Written by each watch run with --closed-sessions; the hook's summary needs it to be recent. */
export declare const MARKER = ".watch.closed-sessions";
export type ClosedNews = {
    id: string;
    title: string;
    lines: string[];
    cwd: string;
};
/** Change-log stamp ("YYYY-MM-DD HH:MM:SS", local time) of a moment. */
export declare const stampOf: (ms: number) => string;
/** Closed sessions of this workspace with important changes waiting (logged at or after `since`), newest activity first. */
export declare function closedSessionNews(outputDir: string, sessionsDir?: string, now?: number, since?: string): ClosedNews[];
/**
 * One toast per closed session with news, until the session runs again (or its news is gone):
 * the state file remembers which sessions were told. Also refreshes the marker for the hook.
 */
export declare function notifyClosedSessions(outputDir: string, opts?: {
    sessionsDir?: string;
    now?: number;
    show?: typeof toast;
}): ClosedNews[];
/**
 * `jirallm sessions:news [--exclude <id>]`: one short block for the prompt hook, naming the closed
 * sessions with news and how to open them; nothing when there is none or --closed-sessions is off.
 */
export declare function sessionsNewsText(outputDir: string, exclude?: string, sessionsDir?: string, now?: number): string;
//# sourceMappingURL=closedSessions.d.ts.map