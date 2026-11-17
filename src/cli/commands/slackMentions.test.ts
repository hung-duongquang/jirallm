import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SlackClient, type SlackSearchMatch } from '../../lib/slack.js';
import { runningSessionKeys, slackMentionChanges, threadDirOf } from './slackMentions.js';

const NOW = Date.parse('2026-11-17T10:30:00Z');
const ts = (iso: string) => `${Date.parse(iso) / 1000}.000100`;
const link = (t: string, thread?: string) =>
  `https://x.slack.com/archives/C1/p${t.replace('.', '')}${thread ? `?thread_ts=${thread}` : ''}`;

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'jl-mentions-'));
  const outputDir = path.join(root, 'jira-export');
  const sessionsDir = path.join(root, 'sessions');
  mkdirSync(path.join(outputDir, 'zod-7'), { recursive: true });
  mkdirSync(sessionsDir);
  // A running session (its monitor is this test process) that works on ZOD-1; a stopped one on ZOD-2.
  writeFileSync(path.join(sessionsDir, 's1.keys'), 'ZOD-1\nUTF-8\n');
  writeFileSync(path.join(sessionsDir, 's1.monitor'), String(process.pid));
  writeFileSync(path.join(sessionsDir, 's2.keys'), 'ZOD-2\n');
  return { outputDir, sessionsDir };
}

function client(matches: SlackSearchMatch[], queries: string[] = []) {
  return new SlackClient({ token: 'xoxp-1' }, (async (u: string, init?: { body?: unknown }) => {
    const method = u.split('/').pop();
    if (method === 'search.messages') queries.push(new URLSearchParams(String(init?.body ?? '')).get('query') ?? '');
    const body =
      method === 'auth.test' ? { ok: true, user_id: 'UME' }
      : method === 'search.messages' ? { ok: true, messages: { total: matches.length, matches } }
      : method === 'conversations.replies' ? { ok: true, messages: [{ ts: matches[0]!.ts, user: 'U2', text: matches[0]!.text }] }
      : method === 'conversations.history' ? { ok: true, messages: [] }
      : { ok: true, channel: { name: 'dev' }, user: { real_name: 'Trang' } };
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch);
}

describe('slack mentions of the running sessions\' tickets', () => {
  it('takes the ticket keys of running sessions only, of projects with exported tickets', () => {
    const { outputDir, sessionsDir } = setup();
    expect([...runningSessionKeys(outputDir, sessionsDir)]).toEqual([['ZOD-1', ['s1']]]);
  });

  it('names a thread by its parent, also for a reply link', () => {
    expect(threadDirOf(link('1794884412.689299'))).toBe('c1-1794884412689299');
    expect(threadDirOf(link('1794884999.000100', '1794884412.689299'))).toBe('c1-1794884412689299');
  });

  it('exports the thread of a new message about the ticket, lets the session follow it, and reports it once', async () => {
    const { outputDir, sessionsDir } = setup();
    const t = ts('2026-11-17T10:00:00Z');
    const queries: string[] = [];
    const matches: SlackSearchMatch[] = [
      { ts: t, user: 'U2', username: 'trang', text: '<https://j/browse/ZOD-1|j/browse/ZOD-1> , do not merge', permalink: link(t), channel: { id: 'C1', is_mpim: true } },
      // My own message and one from before the last day are skipped.
      { ts: ts('2026-11-17T09:00:00Z'), user: 'UME', text: 'ZOD-1 update', permalink: link(ts('2026-11-17T09:00:00Z')) },
      { ts: ts('2026-11-15T09:00:00Z'), user: 'U2', text: 'ZOD-1 old', permalink: link(ts('2026-11-15T09:00:00Z')) },
    ];
    const changes = await slackMentionChanges(outputDir, client(matches, queries), { sessionsDir, now: NOW });
    expect(queries).toEqual(['ZOD-1 after:2026-11-15']);
    const dir = threadDirOf(link(t));
    expect(changes).toEqual([{ line: `slack/${dir}: new message about ZOD-1 from trang in a DM: "j/browse/ZOD-1 , do not merge"`, url: link(t) }]);
    expect(existsSync(path.join(outputDir, 'slack', dir, 'thread.md'))).toBe(true);
    expect(readFileSync(path.join(sessionsDir, 's1.follow'), 'utf8')).toBe(`slack/${dir}\n`);

    // The next round asks from the last message on and reports nothing again.
    expect(await slackMentionChanges(outputDir, client(matches), { sessionsDir, now: NOW + 300_000 })).toEqual([]);
  });

  it('leaves a message in an exported thread to the replies check, but follows the thread', async () => {
    const { outputDir, sessionsDir } = setup();
    const t = ts('2026-11-17T10:00:00Z');
    const dir = threadDirOf(link(t));
    mkdirSync(path.join(outputDir, 'slack', dir), { recursive: true });
    writeFileSync(path.join(outputDir, 'slack', dir, 'thread.md'), '---\n---\n');
    const matches = [{ ts: t, user: 'U2', text: 'ZOD-1', permalink: link(t), channel: { id: 'C1' } }];
    expect(await slackMentionChanges(outputDir, client(matches), { sessionsDir, now: NOW })).toEqual([]);
    expect(readFileSync(path.join(sessionsDir, 's1.follow'), 'utf8')).toBe(`slack/${dir}\n`);
  });
});
