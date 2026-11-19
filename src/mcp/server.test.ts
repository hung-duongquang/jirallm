import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { desktopConfigPaths, updateDesktopConfigs } from './install.js';
import { CARD_URI, UI_EXTENSION, UI_MIME, createServer, type CliRunner } from './server.js';

type Call = { args: string[]; body?: string };

/** A fake CLI: records each run (with the text of a --file/--description-file) and answers per command. */
function fakeCli() {
  const calls: Call[] = [];
  const run: CliRunner = async (args) => {
    const i = args.findIndex((a) => a === '--file' || a === '--description-file');
    calls.push({ args, ...(i >= 0 && { body: readFileSync(args[i + 1]!, 'utf8') }) });
    const dry = args.includes('--dry-run');
    if (args[0] === 'transition' && args.includes('Nope')) return { code: 1, stdout: '', stderr: 'No transition to "Nope"' };
    return { code: 0, stdout: dry ? `[dry-run] ${args[0]} ${args[1]}` : `${args[0]} ${args[1]} ok`, stderr: '' };
  };
  return { calls, run };
}

async function connect(ui: boolean, now = () => 0, pendingDir = mkdtempSync(path.join(tmpdir(), 'jl-pending-'))) {
  const cli = fakeCli();
  const server = createServer({ run: cli.run, now, log: () => {}, pendingDir });
  const client = new Client(
    { name: 'test', version: '1' },
    { capabilities: ui ? { extensions: { [UI_EXTENSION]: { mimeTypes: [UI_MIME] } } } : {} }
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> };
  return { client, call, calls: cli.calls };
}

describe('jirallm mcp', () => {
  it('lists read and write tools; writes link the approval card, apply/cancel are for the card only', async () => {
    const { client } = await connect(true);
    const tools = (await client.listTools()).tools;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const n of ['jira_read', 'jira_search', 'slack_read', 'slack_search', 'confluence_read', 'sharepoint_read']) expect(byName[n]?.annotations?.readOnlyHint, n).toBe(true);
    // With the card they only preview: no client prompt before them, the card is the one approval.
    for (const n of ['jira_comment', 'jira_transition', 'jira_edit']) {
      expect(byName[n]?.annotations, n).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(byName[n]?._meta, n).toEqual({ ui: { resourceUri: CARD_URI } });
    }
    expect(byName.jira_apply?.annotations?.destructiveHint).toBe(true);
    // Without it they write, so the client asks first.
    const plain = Object.fromEntries((await (await connect(false)).client.listTools()).tools.map((t) => [t.name, t]));
    for (const n of ['jira_comment', 'jira_transition', 'jira_edit']) expect(plain[n]?.annotations, n).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(byName.jira_apply?._meta).toEqual({ ui: { visibility: ['app'] } });
    const card = await client.readResource({ uri: CARD_URI });
    expect(card.contents[0]).toMatchObject({ mimeType: UI_MIME });
    expect(String((card.contents[0] as { text: string }).text)).toContain('ui/initialize');
  });

  it('with the card: a write only previews, and the card approval makes it once', async () => {
    const { call, calls } = await connect(true);
    const r = await call('jira_comment', { key: 'ZOD-1', text: 'Looks **good**' });
    expect(calls).toEqual([{ args: ['comment', 'ZOD-1', '--file', expect.any(String), '--dry-run'], body: 'Looks **good**' }]);
    expect(r.content[0]!.text).toMatch(/^Waiting for approval/);
    expect(r.structuredContent).toMatchObject({ status: 'pending', title: 'Comment on ZOD-1', body: 'Looks **good**' });
    // The id is only in _meta (the card's), never in what the model reads.
    const id = r._meta?.approvalId as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(r.content)).not.toContain(id);

    const applied = await call('jira_apply', { id });
    expect(applied.isError).toBeFalsy();
    expect(applied.content[0]!.text).toMatch(/^Done: Comment on ZOD-1/);
    expect(calls[1]).toEqual({ args: ['comment', 'ZOD-1', '--file', expect.any(String)], body: 'Looks **good**' });
    expect((await call('jira_apply', { id })).isError).toBe(true); // once only
    expect(calls).toHaveLength(2);
  });

  it('the card may talk to another server process than the one that proposed (Claude Desktop runs two)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'jl-pending-'));
    const agent = await connect(true, () => 0, dir);
    const view = await connect(true, () => 0, dir);
    const r = await agent.call('jira_comment', { key: 'ZOD-7', text: 'hi' });
    const applied = await view.call('jira_apply', { id: r._meta?.approvalId });
    expect(applied.content[0]!.text).toMatch(/^Done: Comment on ZOD-7/);
    expect(view.calls).toEqual([{ args: ['comment', 'ZOD-7', '--file', expect.any(String)], body: 'hi' }]);
    expect((await agent.call('jira_apply', { id: r._meta?.approvalId })).isError).toBe(true);
    expect(agent.calls).toHaveLength(1); // only the dry run
  });

  it('cancel writes nothing; an hour-old preview is refused; a failed preview leaves nothing pending', async () => {
    let t = 0;
    const { call, calls } = await connect(true, () => t);
    const a = await call('jira_transition', { key: 'ZOD-2', to: 'Resolved' });
    expect(calls[0]!.args).toEqual(['transition', 'ZOD-2', '--to', 'Resolved', '--dry-run']);
    expect((await call('jira_cancel', { id: a._meta?.approvalId })).content[0]!.text).toMatch(/^Cancelled/);
    expect((await call('jira_apply', { id: a._meta?.approvalId })).isError).toBe(true);

    const b = await call('jira_edit', { key: 'ZOD-3', summary: 'New', description: '# Story', labels: ['x', 'y'] });
    expect(calls[1]).toEqual({ args: ['edit', 'ZOD-3', '--summary', 'New', '--labels', 'x,y', '--description-file', expect.any(String), '--dry-run'], body: '# Story' });
    t = 61 * 60_000;
    expect((await call('jira_apply', { id: b._meta?.approvalId })).content[0]!.text).toMatch(/more than an hour old/);

    const bad = await call('jira_transition', { key: 'ZOD-4', to: 'Nope' });
    expect(bad.isError).toBe(true);
    expect(bad._meta?.approvalId).toBeUndefined();
    expect(calls.filter((c) => !c.args.includes('--dry-run'))).toEqual([]);
  });

  it('without the card: the write is made directly (the client asks, as it is marked destructive)', async () => {
    const { call, calls } = await connect(false);
    const r = await call('jira_transition', { key: 'ZOD-5', to: 'Resolved' });
    expect(calls).toEqual([{ args: ['transition', 'ZOD-5', '--to', 'Resolved'] }]);
    expect(r.content[0]!.text).toBe('transition ZOD-5 ok');
  });

  it('read tools run the matching command', async () => {
    const { call, calls } = await connect(true);
    await call('jira_read', { key: 'ZOD-6' });
    await call('slack_read', { url: 'https://x.slack.com/archives/C1/p1700000000000001', since: '2026-11-18', threadOnly: true });
    await call('slack_search', { query: 'ZOD-6', after: '2026-11-01' });
    expect(calls.map((c) => c.args)).toEqual([
      ['fetch', 'ZOD-6', '--with-comments'],
      ['slack', 'https://x.slack.com/archives/C1/p1700000000000001', '--since', '2026-11-18', '--no-channel'],
      ['slack:search', 'ZOD-6', '--after', '2026-11-01'],
    ]);
    expect((await call('jira_read', { key: 'not a key' })).isError).toBe(true);
  });
});

describe('jirallm mcp --install', () => {
  it('finds the classic and packaged Desktop configs and adds jirallm, keeping the rest', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'jl-mcp-'));
    const roaming = path.join(root, 'Roaming');
    const local = path.join(root, 'Local');
    mkdirSync(path.join(roaming, 'Claude'), { recursive: true });
    mkdirSync(path.join(local, 'Claude-Data', 'claude_abc'), { recursive: true });
    const files = desktopConfigPaths({ APPDATA: roaming, LOCALAPPDATA: local }, root);
    expect(files).toEqual([path.join(roaming, 'Claude', 'claude_desktop_config.json'), path.join(local, 'Claude-Data', 'claude_abc', 'claude_desktop_config.json')]);
    writeFileSync(files[1]!, JSON.stringify({ preferences: { a: 1 }, mcpServers: { other: { command: 'x' } } }));

    const entry = { command: 'node', args: ['cli.js', 'mcp'] };
    expect(updateDesktopConfigs(files, entry).map((c) => c.action)).toEqual(['added', 'added']);
    expect(JSON.parse(readFileSync(files[1]!, 'utf8'))).toEqual({ preferences: { a: 1 }, mcpServers: { other: { command: 'x' }, jirallm: entry } });
    expect(readFileSync(`${files[1]}.jirallm.bak`, 'utf8')).toContain('"other"');
    expect(updateDesktopConfigs(files, entry).map((c) => c.action)).toEqual(['unchanged', 'unchanged']);
    expect(updateDesktopConfigs(files, undefined).map((c) => c.action)).toEqual(['removed', 'removed']);
    expect(JSON.parse(readFileSync(files[1]!, 'utf8')).mcpServers).toEqual({ other: { command: 'x' } });
  });
});
