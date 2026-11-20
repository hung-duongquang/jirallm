import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SlackClient, SlackSearchMatch } from '../../lib/slack.js';
import { toastXml } from './prStatus.js';
import { jirallmTerminal } from './resume.js';
import { handlePrompt, markTag, readTags, slackTagChanges } from './slackTags.js';

const ME = 'U0ME';
const NOW = Date.parse('2026-11-20T02:00:00Z');
const at = (iso: string) => String(Date.parse(iso) / 1000) + '.000100';
const hit = (ts: string, text: string, extra: Partial<SlackSearchMatch> = {}): SlackSearchMatch => ({
  ts, text, user: 'U0TRUNG', username: 'trung', permalink: `https://ws.slack.com/archives/C1/p${ts.replace('.', '')}`, channel: { is_mpim: true }, ...extra,
});

function setup(matches: SlackSearchMatch[]) {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'slacktags-'));
  const sessionsDir = mkdtempSync(path.join(tmpdir(), 'slacktags-s-'));
  const queries: string[] = [];
  const calls: string[] = [];
  const client = {
    call: async (method: string) => (calls.push(method), { ok: true, user_id: ME }),
    search: async (q: string) => (queries.push(q), { matches }),
  } as unknown as SlackClient;
  const exported: string[] = [];
  const exportThread = async (url: string) => void exported.push(url);
  return { outputDir, sessionsDir, client, queries, calls, exported, run: () => slackTagChanges(outputDir, client, { sessionsDir, now: NOW, exportThread }) };
}

describe('slackTagChanges', () => {
  it('exports new threads that tag me (not my own messages, not a bare name match) and lists them newest first', async () => {
    const t1 = at('2026-11-20T01:30:00Z');
    const t2 = at('2026-11-20T01:40:00Z');
    const s = setup([
      hit(t2, `check comments 2 PRs nha <@${ME}>`),
      hit(at('2026-11-20T01:41:00Z'), `<@${ME}> self note`, { user: ME }),
      hit(at('2026-11-20T01:42:00Z'), 'mentions the word only'),
      hit(t1, `<@${ME}> Check cái nay tren PRD`, { channel: { name: 'zd-dev' } }),
      hit(at('2026-11-19T20:00:00Z'), `<@${ME}> too old for the first look (2 h)`),
    ]);
    const changes = await s.run();
    expect(s.queries).toEqual([`<@${ME}> after:2026-11-19`]);
    expect(changes.map((c) => c.line)).toEqual([
      `slack/c1-${t1.replace('.', '')}: trung tagged you in #zd-dev: "@… Check cái nay tren PRD"`,
      `slack/c1-${t2.replace('.', '')}: trung tagged you in a group DM: "check comments 2 PRs nha @…"`,
    ]);
    expect(s.exported).toHaveLength(2);
    expect(readTags(s.outputDir).tags.map((t) => t.text)).toEqual(['check comments 2 PRs nha @…', '@… Check cái nay tren PRD']);

    // Next round: nothing new, and "me" is remembered (no auth.test).
    expect(await s.run()).toEqual([]);
    expect(s.calls).toEqual(['auth.test']);
  });

  it('leaves a thread a running session follows to that session', async () => {
    const t1 = at('2026-11-20T01:30:00Z');
    const s = setup([hit(t1, `<@${ME}> any news?`)]);
    writeFileSync(path.join(s.sessionsDir, 's1.monitor'), String(process.pid));
    writeFileSync(path.join(s.sessionsDir, 's1.follow'), `slack/c1-${t1.replace('.', '')}\n`);
    expect(await s.run()).toEqual([]);
    expect(s.exported).toEqual([]);
  });

  it('a new tag in a handled thread brings it back unhandled; dismiss hides it', async () => {
    const t1 = at('2026-11-20T01:30:00Z');
    const s = setup([hit(t1, `<@${ME}> one`)]);
    await s.run();
    const dir = `c1-${t1.replace('.', '')}`;
    expect(markTag(s.outputDir, dir, 'handled')).toBe(true);
    expect(readTags(s.outputDir).tags[0]!.handledAt).toBeTruthy();
    const reply = at('2026-11-20T01:50:00Z');
    s.queries.length = 0;
    const again = await slackTagChanges(s.outputDir, {
      call: async () => ({ ok: true }),
      search: async () => ({ matches: [hit(reply, `<@${ME}> two`, { permalink: `https://ws.slack.com/archives/C1/p${reply.replace('.', '')}?thread_ts=${t1}` })] }),
    } as unknown as SlackClient, { sessionsDir: s.sessionsDir, now: NOW, exportThread: async () => {} });
    expect(again).toHaveLength(1);
    const tags = readTags(s.outputDir).tags;
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ dir, text: '@… two' });
    expect(tags[0]!.handledAt).toBeUndefined();
    expect(markTag(s.outputDir, dir, 'dismissed')).toBe(true);
    expect(readTags(s.outputDir).tags[0]!.dismissed).toBe(true);
    expect(markTag(s.outputDir, 'c1-0000000000000000', 'dismissed')).toBe(false);
  });
});

describe('handling a tag', () => {
  it('starts Claude with the link, the export and the ask-first rule', () => {
    const prompt = handlePrompt({ url: 'https://ws.slack.com/archives/C1/p1', from: 'trung', where: 'a group DM', text: 'check @…' }, 'jira-export/slack/c1-1/thread.md');
    expect(prompt).toContain('trung tagged me in a group DM: https://ws.slack.com/archives/C1/p1');
    expect(prompt).toContain('jira-export/slack/c1-1/thread.md');
    expect(prompt).toMatch(/Ask me before anything that writes/);
  });

  it('opens `jirallm slack:handle <folder>` in a terminal, and only plain arguments', () => {
    const wt = jirallmTerminal(['slack:handle', 'c1-1795140961145419'], 'C:/ws', 'claude: Slack tag', 'win32', true);
    expect(wt.args.slice(-2)).toEqual(['slack:handle', 'c1-1795140961145419']);
    expect(() => jirallmTerminal(['slack:handle', 'x & calc'], 'C:/ws', 't', 'win32', false)).toThrow(/Not a plain argument/);
  });

  it('a toast with buttons that open links', () => {
    const xml = toastXml('trung tagged you', ['check <this> & that'], 'https://s/1', [{ label: 'Handle in Claude', url: 'vscode://jirallm.jirallm-sessions/handle?tag=c1-1&cwd=C%3A%2Fws' }]);
    expect(xml).toContain('<actions><action content="Handle in Claude" activationType="protocol" arguments="vscode://jirallm.jirallm-sessions/handle?tag=c1-1&amp;cwd=C%3A%2Fws"/></actions>');
    expect(xml).toContain('<text>check &lt;this&gt; &amp; that</text>');
  });
});

describe('the VS Code extension', () => {
  it('runs slack:handle only for an export folder name', async () => {
    const src = (await import('node:fs')).readFileSync(path.join(__dirname, '..', '..', '..', 'vscode', 'extension.js'), 'utf8');
    expect(src).toContain("const SLACK_DIR = /^[a-z0-9]{1,20}-\\d{16}$/;");
    expect(src).toContain('run(cwd, `jirallm slack:handle ${tag}`)');
  });
});
