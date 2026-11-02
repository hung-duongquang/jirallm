import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { SlackClient, exportSlackThread, mrkdwnToMarkdown, parseSlackUrl, renderThread, threadTitle, type SlackMessage } from './slack.js';

describe('parseSlackUrl', () => {
  it('turns the p-id into a message ts', () => {
    expect(parseSlackUrl('https://topicushealthcare.slack.com/archives/C0AHFG5A4LV/p1793370497363139')).toEqual({
      workspace: 'topicushealthcare',
      channel: 'C0AHFG5A4LV',
      ts: '1793370497.363139',
      threadTs: undefined,
    });
  });

  it('keeps thread_ts of a reply link', () => {
    const link = parseSlackUrl('https://x.slack.com/archives/C1/p1793370600000100?thread_ts=1793370497.363139&cid=C1');
    expect(link.ts).toBe('1793370600.000100');
    expect(link.threadTs).toBe('1793370497.363139');
  });

  it('rejects other links', () => {
    expect(() => parseSlackUrl('https://example.com/archives/C1/p1793370497363139')).toThrow(/Not a Slack message link/);
    expect(() => parseSlackUrl('https://x.slack.com/client/T1/C1')).toThrow(/Not a Slack message link/);
  });
});

describe('mrkdwnToMarkdown', () => {
  const names = new Map([['U1', 'Linh']]);

  it('converts mentions, links and emphasis', () => {
    expect(mrkdwnToMarkdown('Hi <@U1>, see <https://a.b/c|the PR> in <#C9|dev> *now* ~not~ &amp; &lt;ok&gt;', names)).toBe(
      'Hi @Linh, see [the PR](https://a.b/c) in #dev **now** ~~not~~ & <ok>'
    );
  });

  it('leaves code alone and puts fences on their own lines', () => {
    expect(mrkdwnToMarkdown('run `a *b* c` then ```x &lt; y```', names)).toBe('run `a *b* c` then \n```\nx < y\n```');
  });
});

describe('SlackClient.thread', () => {
  it('follows a reply to its parent thread', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const ts = new URLSearchParams(init.body).get('ts')!;
      calls.push(ts);
      const messages: SlackMessage[] =
        ts === '2.0' ? [{ ts: '2.0', thread_ts: '1.0', text: 'reply' }] : [{ ts: '1.0', thread_ts: '1.0', text: 'parent' }, { ts: '2.0', thread_ts: '1.0', text: 'reply' }];
      return new Response(JSON.stringify({ ok: true, messages }));
    }) as unknown as typeof fetch;
    const client = new SlackClient({ token: 'xoxp-1' }, fetchImpl);
    const messages = await client.thread({ workspace: 'x', channel: 'C1', ts: '2.0' });
    expect(calls).toEqual(['2.0', '1.0']);
    expect(messages.map((m) => m.text)).toEqual(['parent', 'reply']);
  });

  it('reports a missing scope', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: false, error: 'missing_scope', needed: 'channels:history' }))) as unknown as typeof fetch;
    await expect(new SlackClient({ token: 'xoxp-1' }, fetchImpl).thread({ workspace: 'x', channel: 'C1', ts: '1.0' })).rejects.toThrow(
      'needs scope channels:history'
    );
  });
});

describe('renderThread', () => {
  it('renders authors, the linked message, attachments and files', () => {
    const md = renderThread({
      url: 'https://x.slack.com/archives/C1/p1000000000000000',
      channelName: 'zod-dev',
      linkedTs: '1000000060.000000',
      names: new Map([['U1', 'Linh']]),
      messages: [
        { ts: '1000000000.000000', user: 'U1', text: 'question', attachments: [{ title: 'ZOD-1', title_link: 'https://j/ZOD-1', text: 'summary' }] },
        { ts: '1000000060.000000', bot_profile: { name: 'CI' }, text: 'answer', files: [{ id: 'F1', name: 'shot.png', mimetype: 'image/png' }] },
      ],
      localFiles: new Map([['F1', './F1-shot.png']]),
    });
    expect(md).toContain('# Slack thread in #zod-dev');
    expect(md).toContain('(1 + 1 replies)');
    expect(md).toMatch(/## Linh · .*\n\nquestion\n\n> \*\*\[ZOD-1\]\(https:\/\/j\/ZOD-1\)\*\*\n> summary/);
    expect(md).toMatch(/## CI · .*\(linked message\)/);
    expect(md).toContain('![shot.png](./F1-shot.png)');
  });
});

describe('threadTitle', () => {
  it('skips a first line that is only a link', () => {
    const messages = [{ ts: '1.0', text: '<https://acme.atlassian.net/browse/ZOD-1|acme.atlassian.net/browse/ZOD-1>\nPlease check the totals' }];
    expect(threadTitle(messages, new Map())).toBe('Please check the totals');
  });
});

describe('exportSlackThread new replies', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'jl-slack-'));
  afterAll(() => rmSync(outputDir, { recursive: true, force: true }));
  const url = 'https://x.slack.com/archives/C1/p1000000000000000';
  const clientWith = (messages: SlackMessage[]) =>
    new SlackClient({ token: 'xoxp-1' }, (async (u: string) =>
      new Response(JSON.stringify(u.endsWith('conversations.replies') ? { ok: true, messages } : { ok: true, channel: { name: 'dev' }, user: { real_name: 'Linh' } }))) as unknown as typeof fetch);
  const parent = { ts: '1000000000.000000', thread_ts: '1000000000.000000', user: 'U1', text: 'question' };
  const reply = (ts: string, text: string) => ({ ts, thread_ts: parent.ts, user: 'U1', text });

  it('marks replies that arrived since the previous export and keeps the marks on a quiet update', async () => {
    const first = await exportSlackThread(url, { outputDir, client: clientWith([parent, reply('1000000060.000000', 'one')]) });
    expect(first.newReplies).toBe(0);

    const second = await exportSlackThread(url, {
      outputDir,
      client: clientWith([parent, reply('1000000060.000000', 'one'), reply('1000000120.000000', 'two'), reply('1000000180.000000', 'three')]),
    });
    expect(second.newReplies).toBe(2);
    const md = readFileSync(second.path, 'utf8');
    expect(md).toContain('newReplies: 2');
    expect(md.match(/^## .*\(new\)$/gm)).toHaveLength(2);

    const third = await exportSlackThread(url, {
      outputDir,
      client: clientWith([parent, reply('1000000060.000000', 'one'), reply('1000000120.000000', 'two'), reply('1000000180.000000', 'three')]),
    });
    expect(third.newReplies).toBe(2);
  });
});
