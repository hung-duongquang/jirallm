/**
 * Bringing Claude Code sessions back after a reboot. The plugin's SessionStart hook leaves
 * `<id>.open` (holding the session's project dir) in the sessions dir, and its SessionEnd hook
 * removes it when the user ends the session (/exit, /clear, logout). A reboot or a closed window
 * ends no session that way, so what is left are the sessions that were still open. `jirallm resume
 * --vscode <workspace>` turns them into VS Code tasks (one terminal each, run when the folder opens),
 * and each task runs `jirallm resume <id>`, which starts `claude --resume <id>` unless that session is
 * still running.
 */
export declare const defaultSessionsDir: () => string;
/** Marks the tasks jirallm owns in tasks.json; every other task there is left alone. */
export declare const TASK_DETAIL = "jirallm resume";
export declare const COMPOUND_LABEL = "Resume Claude sessions";
export type OpenSession = {
    id: string;
    cwd: string;
    title: string;
    lastActivity: number;
};
/**
 * The sessions left open: an `.open` marker and a transcript written in the last `maxDays` days,
 * oldest first (the order they get their terminals). A marker without a transcript is the
 * throwaway session `claude --resume` starts before switching ids; those are dropped after a day.
 */
export declare function openSessions(sessionsDir?: string, maxDays?: number, now?: number): OpenSession[];
/** Drops a session from the ones brought back. */
export declare function forget(id: string, sessionsDir?: string): boolean;
/**
 * True while the session runs: its plugin monitor is alive and was started after this boot (a pid
 * from before a reboot may belong to another process now).
 */
export declare function isRunning(id: string, sessionsDir?: string, bootMs?: number): boolean;
type Task = Record<string, unknown> & {
    label?: string;
    detail?: string;
};
/** The tasks: one terminal per session, named after it, and a compound one that starts them all when the folder opens. */
export declare function resumeTasks(sessions: OpenSession[], cli: {
    node: string;
    entry: string;
}): Task[];
/** JSON with comments and trailing commas (VS Code's tasks.json), or undefined when it does not parse. */
export declare function parseJsonc(text: string): unknown;
export type TasksResult = {
    file: string;
    changed: boolean;
    count: number;
    error?: string;
};
/**
 * Writes the resume tasks into `<workspace>/.vscode/tasks.json`, replacing the ones jirallm wrote
 * before and keeping every other task. Comments in the file are lost when it is rewritten, so it is
 * only rewritten when the tasks changed. With no open sessions no file is created.
 */
export declare function writeVsCodeTasks(workspace: string, sessions: OpenSession[], cli: {
    node: string;
    entry: string;
}): TasksResult;
/**
 * This CLI as a task or terminal should start it: node and the real path of its entry script (not
 * the .cmd shim), found from this module so it is right whether the CLI or `jirallm ui` asks.
 */
export declare function cliCommand(): {
    node: string;
    entry: string;
};
/** Marks a session open again (it is brought back after a reboot), in the folder its start handshake names. */
export declare function markOpen(id: string, sessionsDir?: string): boolean;
export declare const isMarkedOpen: (id: string, sessionsDir?: string) => boolean;
/** Rewrites `<workspace>/.vscode/tasks.json` from the sessions left open now. */
export declare function refreshVsCodeTasks(workspace: string, sessionsDir?: string): TasksResult;
/** The program and arguments that open a new terminal window running `jirallm resume <id>` in `cwd`. */
export declare function terminalCommand(id: string, cwd: string, title: string, platform?: NodeJS.Platform, hasWt?: boolean): {
    cmd: string;
    args: string[];
};
/** Opens a terminal window that resumes the session (Windows Terminal when installed). */
/**
 * Brings the session back in a terminal: in VS Code (through the jirallm sessions extension, installed
 * on first use) when VS Code is there, else in a terminal window of its own. `note` says why VS Code was not used.
 */
export declare function openInTerminal(id: string, title: string, sessionsDir?: string): {
    where: 'vscode' | 'window';
    note?: string;
};
export type ResumeOptions = {
    vscode?: string;
    forget?: boolean;
    sessionsDir?: string;
};
export declare function runResume(id: string | undefined, opts: ResumeOptions): Promise<void>;
export {};
//# sourceMappingURL=resume.d.ts.map