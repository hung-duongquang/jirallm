// The MCP tools run CLI commands. This pins that contract: every command line an MCP tool can build must
// parse against the real CLI (command name, every --flag, positional count), so renaming a command or an
// option fails here instead of silently breaking the tools of people on Claude Desktop's Chat tab.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../cli/index.js';
import { createServer, type CliRunner } from './server.js';

/** Every model-facing tool with every option filled in, so each flag it can pass is exercised. */
const SAMPLES: Record<string, Record<string, unknown>[]> = {
  jira_read: [{ key: 'ZOD-1' }, { key: 'ZOD-1', full: true }],
  jira_search: [{ jql: 'project = ZOD' }],
  jira_transitions: [{ key: 'ZOD-1' }],
  slack_read: [{ url: 'https://x.slack.com/archives/C1/p1700000000000001', since: '2026-11-18', threadOnly: true }],
  slack_search: [{ query: 'ZOD-1', after: '2026-11-01' }],
  confluence_read: [{ url: 'https://x.atlassian.net/wiki/spaces/Z/pages/1/x' }],
  confluence_search: [{ query: 'tariffs' }],
  sharepoint_read: [{ url: 'https://x.sharepoint.com/sites/s/SitePages/p.aspx' }],
  jira_comment: [{ key: 'ZOD-1', text: 'hi' }],
  jira_transition: [{ key: 'ZOD-1', to: 'Resolved' }],
  jira_edit: [{ key: 'ZOD-1', summary: 's', description: 'd', labels: ['a'], fields: ['priority=High'] }],
};

/** The tools only the approval card calls, with what each needs set up first. */
const CARD_ONLY = ['jira_apply', 'jira_cancel', 'jira_card_event'];

async function commandLines(ui: boolean): Promise<{ tools: string[]; lines: string[][] }> {
  const lines: string[][] = [];
  const run: CliRunner = async (args) => {
    lines.push(args);
    return { code: 0, stdout: 'ok', stderr: '' };
  };
  const server = createServer({ run, ui, log: () => {}, pendingDir: mkdtempSync(path.join(tmpdir(), 'jl-contract-')) });
  const client = new Client({ name: 'contract', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  for (const [name, samples] of Object.entries(SAMPLES)) {
    for (const args of samples) {
      const r = (await client.callTool({ name, arguments: args })) as { _meta?: { approvalId?: string } };
      // With the card, Approve runs the write without --dry-run: that line counts too.
      if (r._meta?.approvalId) await client.callTool({ name: 'jira_apply', arguments: { id: r._meta.approvalId } });
    }
  }
  return { tools, lines };
}

/** The CLI command for a name or alias, else undefined. */
const commandOf = (program: Command, name: string) => program.commands.find((c) => c.name() === name || c.aliases().includes(name));

/** What does not parse in one command line: unknown command, unknown --flag, too many positionals. */
function problems(program: Command, line: string[]): string[] {
  const [name, ...rest] = line;
  const cmd = commandOf(program, name!);
  if (!cmd) return [`no command "${name}"`];
  const out: string[] = [];
  let positionals = 0;
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (!token.startsWith('-')) {
      positionals++;
      continue;
    }
    const option = cmd.options.find((o) => o.long === token || o.short === token);
    if (!option) {
      out.push(`${name}: no option ${token}`);
      continue;
    }
    if (option.required || option.optional) i++; // its value
  }
  const declared = cmd.registeredArguments;
  const variadic = declared.some((a) => a.variadic);
  if (!variadic && positionals > declared.length) out.push(`${name}: ${positionals} positional arguments, takes ${declared.length}`);
  const required = declared.filter((a) => a.required).length;
  if (positionals < required) out.push(`${name}: ${positionals} positional arguments, needs ${required}`);
  return out;
}

describe('MCP tools ↔ CLI contract', () => {
  it('every command line the MCP tools build parses against the real CLI (with and without the card)', async () => {
    const program = buildProgram();
    for (const ui of [false, true]) {
      const { tools, lines } = await commandLines(ui);
      // A new tool needs a sample here, or its command lines would go unchecked.
      expect(tools.filter((t) => !CARD_ONLY.includes(t)).sort()).toEqual(Object.keys(SAMPLES).sort());
      expect(lines.length).toBeGreaterThan(Object.keys(SAMPLES).length);
      expect(lines.flatMap((l) => problems(program, l))).toEqual([]);
    }
  });

  it('notices a renamed command or option', () => {
    const program = buildProgram();
    expect(problems(program, ['comments', 'ZOD-1'])).toEqual(['no command "comments"']);
    expect(problems(program, ['transition', 'ZOD-1', '--target', 'Done'])).toContain('transition: no option --target');
    expect(problems(program, ['fetch', 'ZOD-1', 'ZOD-2'])).toEqual(['fetch: 2 positional arguments, takes 1']);
  });
});
