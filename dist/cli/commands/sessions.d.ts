import { type Delivery } from './watch.js';
export type SessionDelivery = Delivery & {
    read: boolean;
};
export type SessionOverview = {
    id: string;
    /** Slack thread title or first prompt (saved by the plugin's prompt hook, else read from the transcript). */
    title: string;
    keys: string[];
    /** True while the plugin's background monitor for this session is running. */
    monitor: boolean;
    /** The transcript was written in the last two hours, or the monitor runs. */
    live: boolean;
    /** Claude Code runs it now (its monitor started after this boot). */
    running: boolean;
    /** Brought back after a reboot (`jirallm resume`): the plugin marked it open and the user has not ended it. */
    reopen: boolean;
    /** Marked to reopen, not running, and open when VS Code closed or the machine went down (its heartbeat stopped with the others'). */
    lastOpen: boolean;
    /** When its monitor last ran (ms), if known. */
    aliveAt?: number;
    /** Not known to run (no monitor), but its transcript was written since this boot: it may still be open in a terminal. */
    maybeRunning: boolean;
    lastActivity: string;
    /** Changes to the session's tickets that have not been handed to it yet. */
    waiting: number;
    reply?: string;
    readAt?: string;
    deliveries: SessionDelivery[];
    /** Items another running session follows too (markShared). */
    shared?: {
        item: string;
        with: string;
    }[];
};
/** The first prompt the user typed, from the head of a Claude Code transcript (JSONL), or ''. */
export declare function firstPrompt(transcript: string, maxBytes?: number): string;
/**
 * Deletes a session from the sessions view: it is hidden (`<id>.hidden`) and no longer reopened after
 * a reboot (its reopen mark goes). Its records stay: tickets, followed links, title, delivery log and
 * seen markers. A later `/resume` or `claude --resume <id>` then carries on exactly as a resume from the
 * view would (same tickets, follows and changes), and its SessionStart hook drops the hidden mark, so it
 * is listed again. A running session is refused. Returns the number of files written or removed.
 */
export declare function removeSession(id: string, outputDir: string, sessionsDir?: string): number;
/**
 * The Claude Code sessions of this workspace that are live (monitor running or transcript written in
 * the last two hours) or were handed jirallm changes in the last `days` days, newest first: what
 * each got, when and how, and whether a Claude turn has read it. For `jirallm ui`.
 */
export declare function claudeSessions(outputDir: string, days?: number, sessionsDir?: string, now?: number): SessionOverview[];
/**
 * Items (tickets, PRs, runs, threads) that two running sessions both follow: each change to them
 * reaches both, and both may act on it. Naming an item in a session's prompt moves it there; an
 * overlap that is left shows in `jirallm ui` so the user can drop it from one session.
 */
export declare function markShared(sessions: SessionOverview[]): void;
//# sourceMappingURL=sessions.d.ts.map