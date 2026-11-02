import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  SlackClient,
  exportSlackThread,
  mrkdwnToMarkdown,
  parseSlackUrl,
  renderThread,
  searchHits,
  slackSearchQueries,
  threadTitle,
  type SlackMessage,
  type SlackSearchMatch,
} from './slack.js';

describe('slackSearchQueries', () => {
  it('splits on OR outside quotes and quotes bare Jira keys', () => {
    expect(slackSearchQueries('ZOD-3988 OR ZOD-3985 OR #3030')).toEqual(['"ZOD-3988"', '"ZOD-3985"', '#3030']);
    expect(slackSearchQueries('"ZOD-1 OR done" ZOD-2 in:#dev')).toEqual(['"ZOD-1 OR done" "ZOD-2" in:#dev']);
  });

  it('adds after: to each and refuses a malformed date', () => {
    expect(slackSearchQueries('ZOD-1 OR ZOD-2', '2026-10-28')).toEqual(['"ZOD-1" after:2026-10-28', '"ZOD-2" after:2026-10-28']);
    expect(() => slackSearchQueries('ZOD-1', '28-10-2026')).toThrow('YYYY-MM-DD');
  });
});

describe('SlackClient.searchAny', () => {
  it('merges the alternatives newest first, each message once', async () => {
    const byQuery: Record<string, SlackSearchMatch[]> = {
      a: [{ ts: '3.0', permalink: 'p3', channel: { id: 'C1' } }, { ts: '1.0', permalink: 'p1', channel: { id: 'C1' } }],
      b: [{ ts: '2.0', permalink: 'p2', channel: { id: 'C1' } }, { ts: '1.0', permalink: 'p1', channel: { id: 'C1' } }],
    };
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const matches = byQuery[new URLSearchParams(init.body).get('query')!];
      return new Response(JSON.stringify({ ok: true, messages: { total: matches.length, matches, paging: { pages: 1 } } }));
    }) as unknown as typeof fetch;
    const res = await new SlackClient({ token: 'xoxp-1' }, fetchImpl).searchAny(['a', 'b'], 10);
    expect(res.matches.map((m) => m.ts)).toEqual(['3.0', '2.0', '1.0']);
  });
});

describe('SlackClient.search', () => {
  it('pages until max or the last page', async () => {
    const pages: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const params = new URLSearchParams(init.body);
      pages.push(params.get('page')!);
      const n = Number(params.get('count'));
      const matches = Array.from({ length: n }, (_, i) => ({ ts: `${params.get('page')}.${i}`, permalink: 'https://x.slack.com/archives/C1/p1' }));
      return new Response(JSON.stringify({ ok: true, messages: { total: 250, matches, paging: { pages: 3 } } }));
    }) as unknown as typeof fetch;
    const res = await new SlackClient({ token: 'xoxc-1', cookie: 'd' }, fetchImpl).search('q', 150);
    expect(pages).toEqual(['1', '2']);
    expect(res.total).toBe(250);
    expect(res.matches).toHaveLength(150);
  });
});

describe('searchHits', () => {
  const match = (ts: string, permalink: string, text: string, channel: SlackSearchMatch['channel'] = { id: 'C1', name: 'dev' }): SlackSearchMatch => ({
    ts,
    permalink,
    text,
    user: 'U1',
    channel,
  });

  it('folds matches of one thread into the newest and flattens the text', () => {
    const hits = searchHits(
      [
        match('1793353095.1', 'https://x.slack.com/archives/C1/p17933530951?thread_ts=1793275958.8', 'see <https://jira/ZOD-1|ZOD-1>\nfor <@U2>'),
        match('1793280000.1', 'https://x.slack.com/archives/C1/p17932800001?thread_ts=1793275958.8', 'older reply'),
        match('1793270000.1', 'https://x.slack.com/archives/C2/p17932700001', 'other', { id: 'C2', is_mpim: true, name: 'mpdm-a--b-1' }),
      ],
      new Map([
        ['U1', 'Linh'],
        ['U2', 'Hung'],
      ])
    );
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ channel: '#dev', author: 'Linh', text: 'see ZOD-1 for @Hung', more: 1 });
    expect(hits[1]).toMatchObject({ channel: 'group DM', more: 0 });
  });

  it('cuts long text', () => {
    const [hit] = searchHits([match('1.0', 'https://x.slack.com/archives/C1/p1', 'a'.repeat(300))], new Map(), 20);
    expect(hit.text).toHaveLength(20);
    expect(hit.text.endsWith('…')).toBe(true);
  });
});

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
