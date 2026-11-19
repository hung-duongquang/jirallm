// `jirallm mcp`: jirallm as an MCP server, for MCP clients without the Claude Code plugin, such as the Chat tab
// of Claude Desktop. Read tools (Jira, Slack, Confluence, SharePoint) answer at once. Write tools (comment,
// transition, edit) are approved by the person, once:
// - in a client that shows MCP Apps (io.modelcontextprotocol/ui), the write tool only previews (the CLI's
//   --dry-run) and shows an approval card; the card's Approve button calls `jira_apply`, a tool only the
//   card can call (visibility "app"), which makes the change. The model cannot approve its own write.
// - in any other client, the write tool makes the change itself. It is marked as one that changes data
//   (destructiveHint), so the client asks the person before the call.
// Every tool runs the jirallm CLI itself (same Node, same config and keychain token), so behaviour and
// output match the commands exactly.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { APPROVAL_CARD_HTML } from './approvalCard.js';

export const UI_EXTENSION = 'io.modelcontextprotocol/ui';
export const UI_MIME = 'text/html;profile=mcp-app';
export const CARD_URI = 'ui://jirallm/approval-card';
/** An approval left in a card longer than this is refused (the preview may be out of date). */
const APPROVAL_TTL_MS = 60 * 60 * 1000;

export type CliResult = { code: number; stdout: string; stderr: string };
export type CliRunner = (args: string[]) => Promise<CliResult>;

/** Runs this install's CLI (dist/cli/index.js next to dist/mcp/) with the same Node. */
export const runCli: CliRunner = (args) =>
  new Promise((resolve) => {
    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'index.js');
    const child = spawn(process.execPath, [cli, ...args], { windowsHide: true, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 180_000);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

const MAX_TEXT = 100_000;
const text = (t: string, isError = false): CallToolResult => ({
  content: [{ type: 'text', text: t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n… (cut at ${MAX_TEXT} characters)` : t }],
  ...(isError && { isError: true }),
});
/** The CLI's answer as a tool result: its output, or its error message. */
const answer = (r: CliResult): CallToolResult =>
  r.code === 0 ? text(r.stdout.trim() || '(done, no output)') : text(clean(r.stderr) || clean(r.stdout) || `jirallm exited with ${r.code}`, true);

/** Without colour codes and Node's libuv exit assertion on Windows ("Assertion failed: … async.c"), noise for the model. */
const clean = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex -- ANSI colour codes start with ESC.
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .filter((l) => !/^Assertion failed: .*\buv\b|async\.c, line \d+/.test(l))
    .join('\n')
    .trim();

/** Long text goes to the CLI through a temp file (no quoting or length limits); removed after the run. */
function withTextFile<T>(content: string, use: (file: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(tmpdir(), 'jirallm-mcp-'));
  const file = path.join(dir, 'text.md');
  writeFileSync(file, content, 'utf8');
  return use(file).finally(() => rmSync(dir, { recursive: true, force: true }));
}

/** A pending write: the CLI arguments and the text the card shows, until the person approves or cancels. */
type Pending = { args: string[]; body?: string; bodyFlag?: string; title: string; key: string; at: number };

export type WriteRequest = { key: string; title: string; args: string[]; body?: string; bodyFlag?: string };

/** CLI arguments of each write, with the long text (comment, description) passed as a file. */
export const writes = {
  comment: (a: { key: string; text: string }): WriteRequest => ({
    key: a.key,
    title: `Comment on ${a.key}`,
    args: ['comment', a.key],
    body: a.text,
    bodyFlag: '--file',
  }),
  transition: (a: { key: string; to: string }): WriteRequest => ({
    key: a.key,
    title: `Move ${a.key} to "${a.to}"`,
    args: ['transition', a.key, '--to', a.to],
  }),
  edit: (a: { key: string; summary?: string; description?: string; labels?: string[]; fields?: string[] }): WriteRequest => {
    const args = ['edit', a.key];
    if (a.summary !== undefined) args.push('--summary', a.summary);
    if (a.labels) args.push('--labels', a.labels.join(','));
    for (const f of a.fields ?? []) args.push('--field', f);
    const what = [a.summary !== undefined && 'summary', a.description !== undefined && 'description', a.labels && 'labels', a.fields?.length && 'fields'].filter(Boolean).join(', ');
    return {
      key: a.key,
      title: `Edit ${a.key}${what ? ` (${what})` : ''}`,
      args,
      ...(a.description !== undefined && { body: a.description, bodyFlag: '--description-file' }),
    };
  },
};

function runWrite(run: CliRunner, w: Pick<Pending, 'args' | 'body' | 'bodyFlag'>, dryRun: boolean): Promise<CliResult> {
  const extra = dryRun ? ['--dry-run'] : [];
  if (w.body === undefined || !w.bodyFlag) return run([...w.args, ...extra]);
  return withTextFile(w.body, (file) => run([...w.args, w.bodyFlag!, file, ...extra]));
}

export type ServerOptions = {
  run?: CliRunner;
  /** Force the approval card on or off; by default it follows what the client says it can show. */
  ui?: boolean;
  now?: () => number;
  version?: string;
};

export function createServer(opts: ServerOptions = {}): McpServer {
  const run = opts.run ?? runCli;
  const now = opts.now ?? Date.now;
  const pending = new Map<string, Pending>();
  const server = new McpServer({ name: 'jirallm', version: opts.version ?? '0' });

  const showsCards = () => {
    if (opts.ui !== undefined) return opts.ui;
    if (process.env.JIRALLM_MCP_UI === '0') return false;
    const ext = server.server.getClientCapabilities()?.extensions?.[UI_EXTENSION] as { mimeTypes?: string[] } | undefined;
    return Boolean(ext && (!ext.mimeTypes || ext.mimeTypes.includes(UI_MIME)));
  };

  // ---- read tools -------------------------------------------------------------------------------
  const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;
  const key = z.string().regex(/^([\w-]+\/)?[A-Z][A-Z0-9]+-\d+$/, 'a Jira key such as ZOD-1234').describe('Jira issue key, e.g. ZOD-1234');

  server.registerTool(
    'jira_read',
    {
      title: 'Read a Jira ticket',
      description: 'A Jira ticket with its fields, description and comments (also its links and sub-tasks with full: true).',
      inputSchema: { key, full: z.boolean().optional().describe('Also history, worklog, sub-tasks, links and attachments') },
      annotations: read,
    },
    async (a) => answer(await run(['fetch', a.key, a.full ? '--full' : '--with-comments']))
  );
  server.registerTool(
    'jira_search',
    {
      title: 'Search Jira',
      description: 'Search Jira issues by JQL, e.g. `project = ZOD AND status = "In Progress" ORDER BY updated DESC`.',
      inputSchema: { jql: z.string().min(1) },
      annotations: read,
    },
    async (a) => answer(await run(['search', a.jql]))
  );
  server.registerTool(
    'jira_transitions',
    {
      title: 'List the statuses a ticket can move to',
      description: 'The transitions a Jira ticket can take now (use the target name with jira_transition).',
      inputSchema: { key },
      annotations: read,
    },
    async (a) => answer(await run(['transition', a.key, '--list']))
  );
  server.registerTool(
    'slack_read',
    {
      title: 'Read a Slack thread',
      description:
        'A Slack message link (https://<workspace>.slack.com/archives/<channel>/p<id>) with its whole thread as Markdown, plus channel messages posted after it (people often answer in the channel; they can be unrelated).',
      inputSchema: {
        url: z.string().url(),
        since: z.string().optional().describe('Only replies after this day (YYYY-MM-DD) or local time ("YYYY-MM-DD HH:MM")'),
        threadOnly: z.boolean().optional().describe('Leave out the channel messages outside the thread'),
      },
      annotations: read,
    },
    async (a) => answer(await run(['slack', a.url, ...(a.since ? ['--since', a.since] : []), ...(a.threadOnly ? ['--no-channel'] : [])]))
  );
  server.registerTool(
    'slack_search',
    {
      title: 'Search Slack',
      description: 'Search Slack messages (Slack search syntax, e.g. "ZOD-3988 OR pull/3030"); one row per thread, newest first. Open a hit with slack_read.',
      inputSchema: { query: z.string().min(1), after: z.string().optional().describe('Only messages on or after this day (YYYY-MM-DD)') },
      annotations: read,
    },
    async (a) => answer(await run(['slack:search', a.query, ...(a.after ? ['--after', a.after] : [])]))
  );
  server.registerTool(
    'confluence_read',
    {
      title: 'Read a Confluence page',
      description: 'A Confluence page by its link, as Markdown.',
      inputSchema: { url: z.string().url() },
      annotations: read,
    },
    async (a) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'jirallm-mcp-page-'));
      try {
        const r = await run(['page', a.url, '--output-dir', dir]);
        if (r.code !== 0) return answer(r);
        const pages = path.join(dir, 'confluence');
        const page = existsSync(pages) ? readdirSync(pages).map((d) => path.join(pages, d, 'page.md')).find(existsSync) : undefined;
        return page ? text(readFileSync(page, 'utf8')) : answer(r);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
  server.registerTool(
    'confluence_search',
    {
      title: 'Search Confluence',
      description: 'Search Confluence by plain words or CQL; open a hit with confluence_read.',
      inputSchema: { query: z.string().min(1) },
      annotations: read,
    },
    async (a) => answer(await run(['page:search', a.query]))
  );
  server.registerTool(
    'sharepoint_read',
    {
      title: 'Read a SharePoint page or Office document',
      description: 'A SharePoint page (…/SitePages/<page>.aspx) or an Office document link, as Markdown.',
      inputSchema: { url: z.string().url() },
      annotations: read,
    },
    async (a) => answer(await run(['sharepoint', a.url]))
  );

  // ---- write tools ------------------------------------------------------------------------------
  const cardMeta = { ui: { resourceUri: CARD_URI } };
  const write = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;
  const approvalNote =
    'In a client that shows the approval card, nothing is written by this call: the person sees a preview and the change is made only when they press Approve in the card. Then tell them briefly to review the card; do not call the tool again for the same change and do not say it is done.';

  const propose = async (w: WriteRequest): Promise<CallToolResult> => {
    if (!showsCards()) return answer(await runWrite(run, w, false));
    const preview = await runWrite(run, w, true);
    if (preview.code !== 0) return answer(preview);
    const id = randomUUID();
    pending.set(id, { ...w, at: now() });
    const shown = preview.stdout.trim();
    return {
      content: [
        {
          type: 'text',
          text: `Waiting for approval: "${w.title}" is shown to the user in an approval card with this preview. Nothing is written until they press Approve.\n\n${shown}`,
        },
      ],
      structuredContent: { status: 'pending', title: w.title, key: w.key, preview: shown, ...(w.body !== undefined && { body: w.body }) },
      // Only the card reads _meta: the id never reaches the model.
      _meta: { approvalId: id },
    };
  };

  server.registerTool(
    'jira_comment',
    {
      title: 'Comment on a Jira ticket',
      description: `Post a comment (Markdown) on a Jira ticket. ${approvalNote}`,
      inputSchema: { key, text: z.string().min(1).describe('The comment, Markdown') },
      annotations: write,
      _meta: cardMeta,
    },
    async (a) => propose(writes.comment(a))
  );
  server.registerTool(
    'jira_transition',
    {
      title: 'Move a Jira ticket to another status',
      description: `Move a Jira ticket to a status (e.g. "In Review", "Resolved"); jira_transitions lists the possible ones. ${approvalNote}`,
      inputSchema: { key, to: z.string().min(1).describe('Target status name') },
      annotations: write,
      _meta: cardMeta,
    },
    async (a) => propose(writes.transition(a))
  );
  server.registerTool(
    'jira_edit',
    {
      title: 'Edit a Jira ticket',
      description:
        `Change a Jira ticket's summary, description (Markdown, replaces the whole description; read it first with jira_read and keep what should stay, including image lines), labels or other fields. ${approvalNote}`,
      inputSchema: {
        key,
        summary: z.string().optional(),
        description: z.string().optional().describe('The whole new description, Markdown'),
        labels: z.array(z.string()).optional().describe('Replaces all labels'),
        fields: z.array(z.string()).optional().describe('Other fields as "friendlyName=value" or "customfield_NNNNN=value"'),
      },
      annotations: write,
      _meta: cardMeta,
    },
    async (a) => {
      if (a.summary === undefined && a.description === undefined && !a.labels && !a.fields?.length) return text('Nothing to change: give a summary, description, labels or fields.', true);
      return propose(writes.edit(a));
    }
  );

  // ---- tools only the approval card calls -----------------------------------------------------------
  const appOnly = { ui: { visibility: ['app'] } };
  server.registerTool(
    'jira_apply',
    {
      title: 'Apply an approved Jira change',
      description: 'Called by the approval card when the person presses Approve. Not for the model.',
      inputSchema: { id: z.string().uuid() },
      annotations: write,
      _meta: appOnly,
    },
    async (a) => {
      const p = pending.get(a.id);
      pending.delete(a.id);
      if (!p) return text('This change was already applied or cancelled.', true);
      if (now() - p.at > APPROVAL_TTL_MS) return text('This preview is more than an hour old: ask Claude for a fresh one.', true);
      const r = await runWrite(run, p, false);
      return r.code === 0 ? text(`Done: ${p.title}.\n\n${r.stdout.trim()}`) : answer(r);
    }
  );
  server.registerTool(
    'jira_cancel',
    {
      title: 'Cancel a proposed Jira change',
      description: 'Called by the approval card when the person presses Cancel. Not for the model.',
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: true },
      _meta: appOnly,
    },
    async (a) => {
      const p = pending.get(a.id);
      pending.delete(a.id);
      return text(p ? `Cancelled: ${p.title}. Nothing was written.` : 'Nothing to cancel.');
    }
  );

  server.registerResource(
    'approval-card',
    CARD_URI,
    { title: 'jirallm approval card', mimeType: UI_MIME, description: 'Shows a proposed Jira change with Approve and Cancel.' },
    async () => ({ contents: [{ uri: CARD_URI, mimeType: UI_MIME, text: APPROVAL_CARD_HTML }] })
  );

  return server;
}

export async function runMcpServer(version?: string): Promise<void> {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  await createServer({ version }).connect(new StdioServerTransport());
}
