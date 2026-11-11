import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  SlackClient,
  exportSlackThread,
  loadSlackThread,
  mrkdwnToMarkdown,
  parseSlackFileUrl,
  parseSince,
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
    expect(slackSearchQueries('ZOD-1 OR ZOD-2', '2026-10-28')).toEqual(['"ZOD-1" after:2026-10-27', '"ZOD-2" after:2026-10-27']);
    expect(slackSearchQueries('x', '2026-11-01')).toEqual(['x after:2026-10-31']);
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

describe('channel messages outside the thread', () => {
  const url = 'https://x.slack.com/archives/C1/p1000000000000000';
  const parent = { ts: '1000000000.000000', thread_ts: '1000000000.000000', reply_count: 1, user: 'U1', text: 'question' };
  const reply = { ts: '1000000060.000000', thread_ts: parent.ts, user: 'U1', text: 'in thread' };
  const history: SlackMessage[] = [
    { ts: '1000000300.000000', user: 'U1', text: 'answered in channel' },
    { ts: '1000000200.000000', thread_ts: parent.ts, subtype: 'thread_broadcast', user: 'U1', text: 'also sent to channel' },
    { ts: '1000000100.000000', subtype: 'channel_join', user: 'U2', text: 'joined' },
    { ts: '1000000400.000000', thread_ts: '1000000400.000000', reply_count: 3, user: 'U1', text: 'other topic' },
  ];
  const calls: Record<string, string>[] = [];
  const client = new SlackClient({ token: 'xoxp-1' }, (async (u: string, init: { body: string }) => {
    if (u.endsWith('conversations.history')) {
      calls.push(Object.fromEntries(new URLSearchParams(init.body)));
      return new Response(JSON.stringify({ ok: true, messages: history }));
    }
    if (u.endsWith('conversations.replies')) return new Response(JSON.stringify({ ok: true, messages: [parent, reply] }));
    return new Response(JSON.stringify({ ok: true, channel: { name: 'dev' }, user: { real_name: 'Linh' } }));
  }) as unknown as typeof fetch);

  it('reads top-level channel messages after the thread, oldest first, without joins and broadcasts', async () => {
    const loaded = await loadSlackThread(url, client);
    expect(calls[0]).toMatchObject({ channel: 'C1', oldest: parent.ts, latest: String(1000000060 + 12 * 3600), inclusive: 'false' });
    expect(loaded.channelMessages.map((m) => m.text)).toEqual(['answered in channel', 'other topic']);
    const md = renderThread({ ...loaded, linkedTs: loaded.link.ts });
    expect(md).toContain('(1 + 1 replies)');
    expect(md).toMatch(/# In the channel, outside the thread\n[\s\S]*answered in channel[\s\S]*\(own thread, 3 replies\)/);
  });

  it('skips them with channel: false', async () => {
    calls.length = 0;
    const loaded = await loadSlackThread(url, client, { channel: false });
    expect(calls).toHaveLength(0);
    expect(renderThread({ ...loaded, linkedTs: loaded.link.ts })).not.toContain('outside the thread');
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

  it('links the extracted frames of a video', () => {
    const md = renderThread({
      url: 'https://x.slack.com/archives/C1/p1000000000000000',
      linkedTs: '1.0',
      names: new Map(),
      messages: [{ ts: '1.0', text: '', files: [{ id: 'F2', name: 'rec.mp4', mimetype: 'video/mp4' }] }],
      localFiles: new Map([['F2', './F2-rec.mp4']]),
      localFrames: new Map([['F2', { dir: './F2-rec.mp4-frames/', count: 7 }]]),
    });
    expect(md).toContain('- File: [rec.mp4](./F2-rec.mp4)\n- Video frames: [7 extracted frames](./F2-rec.mp4-frames/)');
  });
});

describe('threadTitle', () => {
  it('uses the file title for a message that is only a file', () => {
    expect(threadTitle([{ ts: '1.0', text: '', files: [{ id: 'F1', name: 'rec.mp4', title: 'Screen recording' }] }], new Map())).toBe(
      '[file] Screen recording'
    );
  });

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

describe('Slack file links', () => {
  const fileUrl = 'https://x.slack.com/files/U9/F0CE6EDUY9Z/image.png';

  it('parses the file id and ignores other URLs', () => {
    expect(parseSlackFileUrl(fileUrl)).toEqual({ workspace: 'x', fileId: 'F0CE6EDUY9Z' });
    expect(parseSlackFileUrl('https://x.slack.com/archives/C1/p1000000000000000')).toBeUndefined();
    expect(parseSlackFileUrl('https://example.com/files/U9/F1/a.png')).toBeUndefined();
  });

  it('exports the message that first shared the file, before it has replies', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'jl-slack-file-'));
    const calls: string[] = [];
    const fetchImpl = (async (u: string, init?: { body?: string }) => {
      const method = u.split('/').pop()!;
      calls.push(`${method} ${init?.body ?? ''}`);
      if (method === 'files.info') {
        return new Response(JSON.stringify({
          ok: true,
          file: { id: 'F0CE6EDUY9Z', shares: { private: { C2: [{ ts: '1000000100.000000' }], C1: [{ ts: '1000000000.000000' }] } } },
        }));
      }
      if (method === 'conversations.replies') {
        return new Response(JSON.stringify({ ok: true, messages: [{ ts: '1000000000.000000', user: 'U1', files: [{ id: 'F0CE6EDUY9Z', name: 'image.png', mimetype: 'image/png', url_private: 'https://files.slack.com/x' }] }] }));
      }
      if (u.startsWith('https://files.slack.com/')) return new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } });
      return new Response(JSON.stringify({ ok: true, channel: { name: 'dev' }, user: { real_name: 'Trang' } }));
    }) as unknown as typeof fetch;
    try {
      const t = await exportSlackThread(fileUrl, { outputDir, client: new SlackClient({ token: 'xoxp-1' }, fetchImpl) });
      expect(calls.find((c) => c.startsWith('conversations.replies'))).toContain('channel=C1');
      expect(t.dirName).toBe('c1-1000000000000000');
      expect(t.fileCount).toBe(1);
      const md = readFileSync(t.path, 'utf8');
      expect(md).toContain('url: "https://x.slack.com/archives/C1/p1000000000000000"');
      expect(md).toContain('![image.png](./F0CE6EDUY9Z-image.png)');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe('renderThread --since and last reply', () => {
  const base = {
    url: 'https://x.slack.com/archives/C1/p1000000000000000',
    linkedTs: '1000000000.000000',
    names: new Map([['U1', 'Linh'], ['U2', 'Jason']]),
    messages: [
      { ts: '1000000000.000000', user: 'U1', text: 'question' },
      { ts: '1000000060.000000', user: 'U1', text: 'old reply' },
      { ts: '1000000120.000000', user: 'U2', text: 'the answer' },
    ] as SlackMessage[],
  };

  it('names the newest reply in the header, so a cut output is noticeable', () => {
    expect(renderThread(base)).toMatch(/- Messages: 3 \(1 \+ 2 replies\) · last reply .* by Jason/);
  });

  it('prints the parent and only the replies after --since', () => {
    const md = renderThread({ ...base, since: '1000000060.000000' });
    expect(md).toContain('question');
    expect(md).not.toContain('old reply');
    expect(md).toContain('the answer');
    expect(md).toContain('Showing replies after');
    expect(md).toContain(': 1 of 2 (earlier ones left out');
  });
});

describe('parseSince', () => {
  it('takes a Slack ts, a day or a local time', () => {
    expect(parseSince('1794297958.760439')).toBe('1794297958.760439');
    expect(parseSince('2026-11-10')).toBe(String(new Date(2026, 10, 10).getTime() / 1000));
    expect(parseSince('2026-11-10 15:22')).toBe(String(new Date(2026, 10, 10, 15, 22).getTime() / 1000));
    expect(() => parseSince('yesterday')).toThrow(/--since/);
  });
});
