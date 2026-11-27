import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare const UI_EXTENSION = "io.modelcontextprotocol/ui";
export declare const UI_MIME = "text/html;profile=mcp-app";
export declare const CARD_URI = "ui://jirallm/approval-card";
export type CliResult = {
    code: number;
    stdout: string;
    stderr: string;
};
export type CliRunner = (args: string[]) => Promise<CliResult>;
/** Runs this install's CLI (dist/cli/index.js next to dist/mcp/) with the same Node. */
export declare const runCli: CliRunner;
/** A pending write: the CLI arguments and the text the card shows, until the person approves or cancels. */
type Pending = {
    args: string[];
    body?: string;
    bodyFlag?: string;
    title: string;
    key: string;
    at: number;
};
/**
 * Pending writes, one file each. Not in memory: Claude Desktop starts one server for Claude's tool calls
 * (which proposes the write) and another for the chat view (whose card approves it), so the approval
 * must be readable by every server process of this user. Taking one renames it first, so it runs once.
 */
export declare function pendingStore(dir: string, ttlMs: number, now: () => number): {
    set(id: string, p: Pending): void;
    /** The pending write, removed so a second Approve finds nothing; undefined when gone or never there. */
    take(id: string): Pending | undefined;
};
export type WriteRequest = {
    key: string;
    title: string;
    args: string[];
    body?: string;
    bodyFlag?: string;
};
/** CLI arguments of each write, with the long text (comment, description) passed as a file. */
export declare const writes: {
    comment: (a: {
        key: string;
        text: string;
    }) => WriteRequest;
    transition: (a: {
        key: string;
        to: string;
    }) => WriteRequest;
    edit: (a: {
        key: string;
        summary?: string;
        description?: string;
        labels?: string[];
        fields?: string[];
    }) => WriteRequest;
};
export type ServerOptions = {
    run?: CliRunner;
    /** Force the approval card on or off; by default it follows what the client says it can show. */
    ui?: boolean;
    now?: () => number;
    version?: string;
    log?: (entry: Record<string, unknown>) => void;
    /** Where pending approvals are kept (shared by every server process); default <tmp>/jirallm-mcp-pending. */
    pendingDir?: string;
};
/** Appends one JSON line; starts over past 1 MB. Never fails a call. */
export declare function mcpLog(entry: Record<string, unknown>): void;
export declare function createServer(opts?: ServerOptions): McpServer;
export declare function runMcpServer(version?: string): Promise<void>;
export {};
//# sourceMappingURL=server.d.ts.map