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
    /** Not known to run (no monitor), but its transcript was written since this boot: it may still be open in a terminal. */
    maybeRunning: boolean;
    lastActivity: string;
    /** Changes to the session's tickets that have not been handed to it yet. */
    waiting: number;
    reply?: string;
    readAt?: string;
    deliveries: SessionDelivery[];
};
/** The first prompt the user typed, from the head of a Claude Code transcript (JSONL), or ''. */
export declare function firstPrompt(transcript: string, maxBytes?: number): string;
/**
 * The Claude Code sessions of this workspace that are live (monitor running or transcript written in
 * the last two hours) or were handed jirallm changes in the last `days` days, newest first: what
 * each got, when and how, and whether a Claude turn has read it. For `jirallm ui`.
 */
export declare function claudeSessions(outputDir: string, days?: number, sessionsDir?: string, now?: number): SessionOverview[];
//# sourceMappingURL=sessions.d.ts.map